import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ENVIRONMENT } from '../config/environment.js';
import { nightvisionService } from '../services/index.js';
import { AuthStatusParamsSchema, DoctorParamsSchema, LoginHelpParamsSchema } from '../types/index.js';
import { isCliVersionBelow, MIN_CLI_VERSION } from '../utils/cli-version.js';
import { jsonText } from '../utils/tool-response.js';
import { registerNightVisionTool } from './metadata.js';

/**
 * Register setup/onboarding diagnostics tools.
 */
export function registerDoctorTools(server: McpServer): void {
  registerNightVisionTool(server,
    'login-help',
    LoginHelpParamsSchema,
    async (_args, _extra) => {
      return jsonText({
        ok: true,
        status: 'success',
        data: {
          api_url: ENVIRONMENT.CURRENT_API_URL,
          login_command: `${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`,
          token_file: '~/.nightvision/token',
          guidance: [
            'Authenticate with your own NightVision account.',
            'Do not paste shared NightVision tokens into chat, repository files, managed MCP config, or CLAUDE.md.',
            'After login, restart the MCP client if it does not pick up the saved token.'
          ]
        }
      });
    }
  );

  registerNightVisionTool(server,
    'doctor',
    DoctorParamsSchema,
    async (args, _extra) => {
      const blockers: string[] = [];
      const warnings: string[] = [];
      const cliInstalled = await nightvisionService.isInstalled();
      let cliVersion: string | null = null;

      if (!cliInstalled) {
        blockers.push('cli_not_installed');
      } else {
        cliVersion = await nightvisionService.getCliVersion();
        if (!cliVersion) {
          warnings.push('NightVision CLI is installed, but its version could not be determined.');
        } else if (isCliVersionBelow(cliVersion, MIN_CLI_VERSION)) {
          warnings.push(`NightVision CLI ${cliVersion} is older than supported minimum ${MIN_CLI_VERSION}.`);
        }
      }

      const token = nightvisionService.getToken();
      let authValid: boolean | null = null;
      let user = null as Awaited<ReturnType<typeof nightvisionService.getAuthenticatedUser>>;
      if (!token) {
        blockers.push('not_authenticated');
      } else if (args.validate_auth) {
        const result = await nightvisionService.getAuthenticatedUserResult(true);
        if (result.status === 'authenticated') {
          user = result.user;
          authValid = true;
        } else if (result.status === 'unauthenticated') {
          authValid = false;
          blockers.push('invalid_or_expired_token');
        } else {
          // Outage/DNS/5xx: report unavailability, not a bad token.
          authValid = null;
          blockers.push('nightvision_api_unavailable');
          warnings.push(`Could not reach the NightVision API to validate the token: ${result.message}`);
        }
      }

      const data = {
        api_url: ENVIRONMENT.CURRENT_API_URL,
        cli: {
          installed: cliInstalled,
          version: cliVersion,
          minimum_supported_version: MIN_CLI_VERSION
        },
        auth: {
          token_present: !!token,
          token_prefix: token ? `${token.slice(0, 8)}...` : null,
          validated: args.validate_auth ? authValid : null,
          user: user ? {
            id: user.id,
            email: user.email,
            name: user.name,
            organization: user.organization,
            roles: user.roles
          } : null
        },
        environment: {
          default_project: process.env.NIGHTVISION_DEFAULT_PROJECT || null,
          target_app_auth_id: process.env.NIGHTVISION_CREDS_ID ? 'set' : null
        },
        next_steps: [
          !cliInstalled ? `Install the NightVision CLI and make sure \`${ENVIRONMENT.NIGHTVISION_CLI_PATH} version\` works.` : null,
          !token ? `Run ${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL} or use the authenticate tool.` : null,
          !process.env.NIGHTVISION_DEFAULT_PROJECT ? 'Set NIGHTVISION_DEFAULT_PROJECT or pass nightvision_project to run-app-security-scan.' : null
        ].filter(Boolean)
      };

      if (blockers.length > 0) {
        return jsonText({
          ok: false,
          status: 'blocked',
          error: {
            code: 'NIGHTVISION_SETUP_BLOCKED',
            message: 'NightVision setup is not ready.',
            details: data
          },
          blockers,
          warnings: warnings.length > 0 ? warnings : undefined
        });
      }

      return jsonText({
        ok: true,
        status: warnings.length > 0 ? 'partial' : 'success',
        data,
        warnings: warnings.length > 0 ? warnings : undefined
      });
    }
  );

  registerNightVisionTool(server,
    'auth-status',
    AuthStatusParamsSchema,
    async (args, _extra) => {
      const token = nightvisionService.getToken();
      let valid: boolean | null = null;
      let user = null as Awaited<ReturnType<typeof nightvisionService.getAuthenticatedUser>>;
      const blockers: string[] = [];

      if (!token) {
        blockers.push('not_authenticated');
      } else if (args.validate) {
        const result = await nightvisionService.getAuthenticatedUserResult(true);
        if (result.status === 'authenticated') {
          user = result.user;
          valid = true;
        } else if (result.status === 'unauthenticated') {
          valid = false;
          blockers.push('invalid_or_expired_token');
        } else {
          // Outage/DNS/5xx: report unavailability, not a bad token.
          valid = null;
          blockers.push('nightvision_api_unavailable');
        }
      }

      const data = {
        api_url: ENVIRONMENT.CURRENT_API_URL,
        token_present: !!token,
        token_prefix: token ? `${token.slice(0, 8)}...` : null,
        validated: args.validate ? valid : null,
        user: user ? {
          id: user.id,
          email: user.email,
          name: user.name,
          organization: user.organization,
          roles: user.roles
        } : null,
        login_command: `${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`
      };

      if (blockers.length > 0) {
        return jsonText({
          ok: false,
          status: 'blocked',
          error: {
            code: 'NIGHTVISION_AUTH_BLOCKED',
            message: 'NightVision authentication is not ready.',
            details: data
          },
          blockers
        });
      }

      return jsonText({
        ok: true,
        status: 'success',
        data
      });
    }
  );
}
