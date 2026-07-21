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
  // `blocker` is the classified blocker code, so a caller that accumulates its
  // own blockers (rather than forwarding `response`) does not lose the
  // outage-vs-access-denied distinction.
  | { ok: false; response: ReturnType<typeof jsonText>; blocker: string };

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

// A transient API outage (5xx or a network/DNS failure) is not a permission
// problem. Detect it so project resolution reports nightvision_api_unavailable
// (retry, do not re-auth) instead of PROJECT_ACCESS_DENIED, matching how
// requireAuthenticatedUser treats a token-validation outage.
function looksLikeServiceOutage(error: any): boolean {
  const status = typeof error?.statusCode === 'number'
    ? error.statusCode
    : typeof error?.response?.status === 'number'
      ? error.response.status
      : undefined;
  if (status !== undefined) return status >= 500;
  // Include the CLI's stderr (surfaced by executeCommand) so a connectivity
  // failure on the CLI-backed project lookup is classified, not just axios errors.
  const msg = `${String(error?.message ?? error ?? '')} ${String(error?.stderr ?? '')}`;
  // A socket-level EACCES ("dial tcp <ip>:443: connect: permission denied") is a
  // network egress block, not a project-access rejection. Classify it as an
  // outage before the rejection guard below can match the bare "permission denied".
  if (/\bEACCES\b/i.test(msg) || (/permission denied/i.test(msg) && /dial tcp|connect:/i.test(msg))) {
    return true;
  }
  // Explicit access-rejection language wins, so a plain not-found (or a project
  // whose name happens to contain a network token) is never misread as an outage.
  if (/not found|does not exist|no such project|unauthorized|not authorized|forbidden|permission denied/i.test(msg)) {
    return false;
  }
  if (/status code\s+5\d\d/i.test(msg)) return true;
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|fetch failed|timed?\s?out|unreachable|connection (refused|reset)|no such host|i\/o timeout|context deadline exceeded|server misbehaving|tls handshake|dial tcp|internal server error|bad gateway|service unavailable|gateway timeout/i.test(msg);
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
      }),
      blocker: 'nightvision_project_required'
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
        // Let a lookup error propagate to the outer catch so an outage on this
        // fallback is classified (nightvision_api_unavailable) rather than
        // swallowed to null and reported as PROJECT_ACCESS_DENIED. A genuine
        // not-found still reaches the outer catch and stays access-denied.
        project = await nightvisionService.getProjectByName(projectName);
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
        }),
        blocker: 'project_access_denied'
      };
    }

    return { ok: true, project };
  } catch (error: any) {
    if (looksLikeServiceOutage(error)) {
      return {
        ok: false,
        response: serviceUnavailable(`Could not resolve NightVision project ${projectName || projectId} because the API was unreachable: ${error.message}`),
        blocker: 'nightvision_api_unavailable'
      };
    }
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
      }),
      blocker: 'project_access_denied'
    };
  }
}
