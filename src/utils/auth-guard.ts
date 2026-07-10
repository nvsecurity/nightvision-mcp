import { ENVIRONMENT } from '../config/environment.js';
import { nightvisionService } from '../services/index.js';
import { jsonText } from './tool-response.js';

export interface AuthenticatedUser {
  id: string | null;
  email: string | null;
  name: string | null;
  organization: unknown;
  roles: unknown;
  raw: unknown;
}

export type AuthGuardResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; response: ReturnType<typeof jsonText> };

export type ProjectGuardResult =
  | { ok: true; project: Record<string, any> | null }
  | { ok: false; response: ReturnType<typeof jsonText> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authBlocked(message: string, code = 'NOT_AUTHENTICATED') {
  return jsonText({
    ok: false,
    status: 'blocked',
    error: {
      code,
      message,
      details: {
        login_command: `${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`
      }
    },
    blockers: ['not_authenticated']
  });
}

function serviceUnavailable(message: string) {
  return jsonText({
    ok: false,
    status: 'blocked',
    error: {
      code: 'NIGHTVISION_API_UNAVAILABLE',
      message,
      details: {
        hint: 'This looks like a transient connectivity or NightVision service issue, not a bad token. Retry shortly; do not re-authenticate solely because of this.'
      }
    },
    blockers: ['nightvision_api_unavailable']
  });
}

export async function requireAuthenticatedUser(): Promise<AuthGuardResult> {
  if (!nightvisionService.getToken()) {
    return {
      ok: false,
      response: authBlocked('NightVision authentication is required. Authenticate as your own NightVision user before running this tool.')
    };
  }

  const result = await nightvisionService.getAuthenticatedUserResult();

  if (result.status === 'authenticated') {
    return { ok: true, user: result.user };
  }

  // A transient network/service error must not be reported as an expired token,
  // or every tool would tell the user to needlessly re-authenticate on a blip.
  if (result.status === 'error') {
    return {
      ok: false,
      response: serviceUnavailable(`Could not validate the NightVision token because the API was unreachable: ${result.message}`)
    };
  }

  return {
    ok: false,
    response: authBlocked('NightVision token is missing, invalid, or expired. Re-authenticate before running this tool.', 'INVALID_OR_EXPIRED_TOKEN')
  };
}

function projectsFrom(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as any;
  if (Array.isArray(obj.results)) return obj.results;
  if (Array.isArray(obj.projects)) return obj.projects;
  return [];
}

async function findProjectById(projectId: string): Promise<Record<string, any> | null> {
  const raw = await nightvisionService.executeCommand(['project', 'list'], 'json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return projectsFrom(parsed).find((project) => project.id === projectId) || null;
}

export async function requireProjectAccess(options: {
  project?: string | null;
  project_id?: string | null;
  action: string;
}): Promise<ProjectGuardResult> {
  const projectName = options.project || null;
  const projectId = options.project_id || null;

  if (!projectName && !projectId) {
    return {
      ok: false,
      response: jsonText({
        ok: false,
        status: 'blocked',
        error: {
          code: 'PROJECT_REQUIRED',
          message: `A NightVision project is required before ${options.action}. Pass project or project_id.`
        },
        blockers: ['nightvision_project_required']
      })
    };
  }

  try {
    let project: Record<string, any> | null;
    if (projectId) {
      project = await findProjectById(projectId);
    } else if (projectName && UUID_PATTERN.test(projectName)) {
      // A UUID-shaped value in the name field is ambiguous: it may be a project
      // id, or a project whose name genuinely looks like a UUID. Try id lookup
      // first, then fall back to name lookup so such projects are not denied.
      project = await findProjectById(projectName);
      if (!project) {
        project = await nightvisionService.getProjectByName(projectName).catch(() => null);
      }
    } else {
      project = await nightvisionService.getProjectByName(projectName!);
    }

    if (!project) {
      return {
        ok: false,
        response: jsonText({
          ok: false,
          status: 'blocked',
          error: {
            code: 'PROJECT_ACCESS_DENIED',
            message: `Cannot access NightVision project ${projectName || projectId}. Check the project identifier and user permissions.`
          },
          blockers: ['project_access_denied']
        })
      };
    }

    return { ok: true, project };
  } catch (error: any) {
    return {
      ok: false,
      response: jsonText({
        ok: false,
        status: 'blocked',
        error: {
          code: 'PROJECT_ACCESS_DENIED',
          message: `Cannot access NightVision project ${projectName || projectId}: ${error.message}`
        },
        blockers: ['project_access_denied']
      })
    };
  }
}
