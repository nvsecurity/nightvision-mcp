import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { statSync } from 'fs';
import path from 'path';
import { nightvisionService } from '../services/index.js';
import { PreflightAppParamsSchema } from '../types/index.js';
import { isNonAppSourcePath } from '../utils/app-source-path.js';
import { detectLanguages } from '../utils/language-detect.js';
import { writeManifest } from '../utils/manifest.js';
import { localTargetName } from '../utils/project-target-naming.js';
import { resolveTargetUrl } from '../utils/runtime-detect.js';
import { getRepoMetadata } from '../utils/repo-metadata.js';
import { jsonText } from '../utils/tool-response.js';

function existingDirectory(projectPath: string): boolean {
  try {
    return statSync(projectPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Register app preflight tools with the MCP server.
 */
export function registerPreflightTools(server: McpServer): void {
  server.tool(
    'preflight-app',
    PreflightAppParamsSchema,
    async (args, _extra) => {
      const projectPath = path.resolve(args.project_path || process.cwd());
      const blockers: string[] = [];
      const warnings: string[] = [];

      try {
        if (!existingDirectory(projectPath)) {
          return jsonText({
            ok: false,
            status: 'blocked',
            error: {
              code: 'PROJECT_PATH_NOT_FOUND',
              message: `Project path is not a readable directory: ${projectPath}`
            },
            blockers: ['project_path_not_found']
          });
        }

        if (isNonAppSourcePath(projectPath)) {
          return jsonText({
            ok: false,
            status: 'blocked',
            error: {
              code: 'PROJECT_PATH_NOT_APP_SOURCE',
              message: `project_path resolved to "${projectPath}", which is your home or filesystem-root directory, not an app source tree. Pass project_path set to the app's actual source directory so API Discovery inspects the repo rather than the home directory.`
            },
            blockers: ['project_path_not_app_source']
          });
        }

        const repo = getRepoMetadata(projectPath);
        const language = detectLanguages(projectPath);
        const runtime = await resolveTargetUrl(args.target_url, args.timeout_seconds);
        const appName = args.app_name || repo.repo_name;
        const nightvisionProject = args.project_name || process.env.NIGHTVISION_DEFAULT_PROJECT || null;
        const targetName = localTargetName(repo.repo_name, appName);
        const tokenPresent = !!nightvisionService.getToken();
        const authResult = tokenPresent
          ? await nightvisionService.getAuthenticatedUserResult()
          : { status: 'unauthenticated' as const };
        const authenticatedUser = authResult.status === 'authenticated' ? authResult.user : null;
        const authenticated = !!authenticatedUser;

        if (!tokenPresent || authResult.status === 'unauthenticated') {
          blockers.push(tokenPresent ? 'invalid_or_expired_token' : 'not_authenticated');
        } else if (authResult.status === 'error') {
          // A transient outage/DNS/5xx is not an expired token; do not tell the
          // user to re-authenticate. Surface it as an availability blocker so an
          // unattended workflow retries rather than stalling on a bogus re-login.
          blockers.push('nightvision_api_unavailable');
          warnings.push(`Could not reach the NightVision API to validate authentication: ${authResult.message}`);
        }

        if (!args.target_url) {
          blockers.push('target_url_required');
          warnings.push('Pass target_url set to the running app URL (for example http://127.0.0.1:8080). The agent knows this; the harness does not guess it.');
        } else if (!runtime.target_url) {
          blockers.push('runtime_url_not_reachable');
        }

        if (!nightvisionProject) {
          warnings.push('No NightVision project was supplied and NIGHTVISION_DEFAULT_PROJECT is not set.');
        }

        if (language.languages.length === 0) {
          warnings.push('No supported API Discovery language was detected. DAST can still run as a WEB target.');
        }

        const data = {
          repo,
          app: {
            app_name: appName,
            project_path: projectPath,
            languages: language.languages,
            frameworks: language.frameworks,
            package_manager: language.package_manager,
            target_url: runtime.target_url,
            checked_urls: runtime.checked_urls
          },
          nightvision: {
            authenticated,
            user: authenticatedUser ? {
              id: authenticatedUser.id,
              email: authenticatedUser.email,
              name: authenticatedUser.name,
              organization: authenticatedUser.organization,
              roles: authenticatedUser.roles
            } : null,
            project_name: nightvisionProject,
            target_name: targetName
          },
          blockers,
          warnings
        };

        const manifestPath = await writeManifest(projectPath, {
          generated_at: new Date().toISOString(),
          workflow: 'preflight-app',
          ...data
        });

        return jsonText({
          ok: true,
          status: blockers.length > 0 || warnings.length > 0 ? 'partial' : 'success',
          data: {
            ...data,
            manifest_path: manifestPath
          },
          warnings
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'error',
          error: {
            code: 'PREFLIGHT_FAILED',
            message: `Failed to run NightVision app preflight: ${error.message}`
          }
        });
      }
    }
  );
}
