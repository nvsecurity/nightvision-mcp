import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { saveToken, clearToken } from '../config/token.js';
import {
  AuthenticateParamsSchema,
  CreateHeaderCredentialParamsSchema,
  CreateCookieCredentialParamsSchema,
  AssignCredentialToTargetsParamsSchema,
  SavePlaywrightScriptParamsSchema,
  UpdatePlaywrightScriptParamsSchema,
  GetAuthCredentialParamsSchema,
  ListAuthCredentialsParamsSchema,
} from '../types/index.js';
import { ENVIRONMENT } from '../config/environment.js';
import { requireAuthenticatedUser, requireProjectAccess } from '../utils/auth-guard.js';
import { registerNightVisionTool } from './metadata.js';

const PLAYWRIGHT_AUTH_REQUIRED =
  'Username/password target app auth and expiring session credentials must use Playwright script auth. Use save-playwright-script or run-app-security-scan with app_auth.type="playwright_script".';

/**
 * Register authentication-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerAuthTools(server: McpServer): void {
  registerNightVisionTool(server,
    "authenticate",
    AuthenticateParamsSchema,
    async (args, _extra) => {
      try {
        const { token, create_new, expiry_date } = args;
        
        // Creating a new token
        if (create_new) {
          try {
            // Inform the user about the interactive login process
            console.error("\n⚠️ The NightVision CLI requires an interactive login session to create a new token.");
            console.error("A login prompt will appear in the terminal where the MCP server is running.");
            console.error("Please switch to that terminal and complete the login process when prompted.\n");
            
            const newToken = await nightvisionService.createToken(expiry_date);
            
            // Store the new token
            nightvisionService.setToken(newToken);
            saveToken(newToken);
            
            // Verify the token works. Distinguish a transient outage from a real
            // rejection so a network blip does not read as a failed login.
            const result = await nightvisionService.getAuthenticatedUserResult(true);
            if (result.status === 'error') {
              return {
                content: [{
                  type: "text" as const,
                  text: `Created and saved a new token (starts with: ${newToken.substring(0, 8)}...) but could not verify it right now because the NightVision API was unreachable: ${result.message}\n\nThe token was kept; retry shortly rather than re-running login.`
                }],
                isError: true
              };
            }
            if (result.status !== 'authenticated') {
              return {
                content: [{
                  type: "text" as const,
                  text: `Created a new token (starts with: ${newToken.substring(0, 8)}...) but it couldn't be validated.\n\nThe login process may not have completed successfully. Please try again or run the following command in your terminal:\n${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`
                }],
                isError: true
              };
            }

            return {
              content: [{
                type: "text" as const,
                text: `Successfully created and saved a new authentication token. Token starts with: ${newToken.substring(0, 8)}...\nThis token can be used with both the NightVision CLI and API requests.`
              }]
            };
          } catch (error: any) {
            return {
              content: [{
                type: "text" as const,
                text: `Failed to create new token: ${error.message}\n\nThe NightVision CLI requires an interactive login session. Please run the following command in your terminal:\n${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`
              }],
              isError: true
            };
          }
        }
        
        // Using a provided token
        if (token) {
          nightvisionService.setToken(token);
          saveToken(token);
          
          // Validate the token, distinguishing a transient outage (keep the token
          // and retry) from a real rejection (clear it and re-login). A 5xx or
          // network failure must not wipe a good token or claim it is invalid.
          const result = await nightvisionService.getAuthenticatedUserResult(true);
          if (result.status === 'error') {
            return {
              content: [{
                type: "text" as const,
                text: `Saved the provided token but could not verify it right now because the NightVision API was unreachable: ${result.message}\n\nThe token was kept; retry shortly rather than re-authenticating.`
              }],
              isError: true
            };
          }
          if (result.status !== 'authenticated') {
            nightvisionService.setToken(null);
            clearToken();
            return {
              content: [{
                type: "text" as const,
                text: `The provided token is not valid.\n\nPlease run the following command and then try again:\n${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`
              }],
              isError: true
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: `Successfully authenticated. Token starts with: ${token.substring(0, 8)}...`
            }]
          };
        }
        
        // Check authentication status if no parameters provided
        if (!token && !create_new) {
          const currentToken = nightvisionService.getToken();
          if (currentToken) {
            // Verify the token works, distinguishing an outage from expiry.
            const result = await nightvisionService.getAuthenticatedUserResult(true);
            if (result.status === 'authenticated') {
              return {
                content: [{
                  type: "text" as const,
                  text: `Authenticated successfully. Token starts with: ${currentToken.substring(0, 8)}...`
                }]
              };
            }
            if (result.status === 'error') {
              return {
                content: [{
                  type: "text" as const,
                  text: `You have a token (starts with: ${currentToken.substring(0, 8)}...) but could not verify it right now because the NightVision API was unreachable: ${result.message}\n\nRetry shortly; do not re-authenticate solely because of this.`
                }],
                isError: true
              };
            }
            return {
              content: [{
                type: "text" as const,
                text: `You have a token (starts with: ${currentToken.substring(0, 8)}...) but it appears to be invalid or expired.\n\nPlease run the following command and then try again:\n${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`
              }],
              isError: true
            };
          } else {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Not authenticated. Please provide a token or create a new one.` 
              }]
            };
          }
        }
        
        return {
          content: [{ 
            type: "text" as const, 
            text: "Please provide a token or set create_new to true" 
          }],
          isError: true
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Authentication error: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Create Header Credential
   */
  registerNightVisionTool(server,
    "create-header-credential",
    CreateHeaderCredentialParamsSchema,
    async (args, _extra) => {
      try {
        if (args.credential_lifetime !== 'stable') {
          return {
            content: [{
              type: "text" as const,
              text: `Header credentials are only allowed for stable non-expiring target app credentials. ${PLAYWRIGHT_AUTH_REQUIRED}`
            }],
            isError: true
          };
        }
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const projectAccess = await requireProjectAccess({
          project: args.project,
          action: 'creating a header credential'
        });
        if (!projectAccess.ok) return projectAccess.response;

        const result = await nightvisionService.createHeaderCredential(args);
        return {
          content: [{
            type: "text" as const,
            text: `Header credential created.\nID: ${result.id}\nName: ${result.name}\nHeaders: ${args.headers.map((h) => h.name).join(', ')}\nProject: ${result.project_name || result.project}`
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${error.message}` }], isError: true };
      }
    }
  );

  /**
   * Create Cookie Credential
   */
  registerNightVisionTool(server,
    "create-cookie-credential",
    CreateCookieCredentialParamsSchema,
    async (args, _extra) => {
      try {
        if (args.credential_lifetime !== 'stable') {
          return {
            content: [{
              type: "text" as const,
              text: `Cookie credentials are only allowed for stable non-expiring target app credentials. ${PLAYWRIGHT_AUTH_REQUIRED}`
            }],
            isError: true
          };
        }
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const projectAccess = await requireProjectAccess({
          project: args.project,
          action: 'creating a cookie credential'
        });
        if (!projectAccess.ok) return projectAccess.response;

        const result = await nightvisionService.createCookieCredential({
          name: args.name,
          cookie: args.cookies,
          project: args.project,
          description: args.description,
        });
        return {
          content: [{
            type: "text" as const,
            text: `Cookie credential created.\nID: ${result.id}\nName: ${result.name}\nCookies: ${args.cookies.map((c) => c.name).join(', ')}\nProject: ${result.project_name || result.project}`
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${error.message}` }], isError: true };
      }
    }
  );

  /**
   * Assign Credential to Targets
   */
  registerNightVisionTool(server,
    "assign-credential-to-targets",
    AssignCredentialToTargetsParamsSchema,
    async (args, _extra) => {
      try {
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        await nightvisionService.assignCredentialToTargets(args.credential_id, args.target_ids);
        return {
          content: [{
            type: "text" as const,
            text: `Credential assigned to ${args.target_ids.length} target(s).`
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Failed: ${error.message}` }], isError: true };
      }
    }
  );

  /**
   * Save Playwright Script Credential
   */
  registerNightVisionTool(server,
    "save-playwright-script",
    SavePlaywrightScriptParamsSchema,
    async (args, _extra) => {
      try {
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const projectAccess = await requireProjectAccess({
          project: args.project,
          action: 'creating a Playwright script credential'
        });
        if (!projectAccess.ok) return projectAccess.response;

        const result = await nightvisionService.createScriptCredential({
          name: args.name,
          script_content: args.script_content,
          project: args.project,
          script_first_url: args.script_first_url,
          description: args.description,
        });

        return {
          content: [{
            type: "text" as const,
            text: `Playwright script credential saved.\nID: ${result.id}\nName: ${result.name}\nProject: ${result.project_name || result.project}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to save script credential: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  /**
   * Update Playwright Script Credential
   */
  registerNightVisionTool(server,
    "update-playwright-script",
    UpdatePlaywrightScriptParamsSchema,
    async (args, _extra) => {
      try {
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const { id, ...updates } = args;
        const result = await nightvisionService.updateScriptCredential(id, updates);

        return {
          content: [{
            type: "text" as const,
            text: `Playwright script credential updated.\nID: ${result.id}\nName: ${result.name}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to update script credential: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Auth Credential Details (including Playwright script content)
   */
  registerNightVisionTool(server,
    "get-auth-credential",
    GetAuthCredentialParamsSchema,
    async (args, _extra) => {
      try {
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        if (!args.id && (!args.name || !args.project_id)) {
          return {
            content: [{ type: "text" as const, text: "Provide either 'id' (UUID) or both 'name' and 'project_id'." }],
            isError: true
          };
        }

        let cred: any;
        if (args.id) {
          cred = await nightvisionService.getCredential(args.id);
        } else {
          const projectAccess = await requireProjectAccess({
            project_id: args.project_id,
            action: 'reading an auth credential'
          });
          if (!projectAccess.ok) return projectAccess.response;

          cred = await nightvisionService.getCredentialByName(args.project_id!, args.name!);
        }

        const lines = [
          `Credential: ${cred.name}`,
          `ID: ${cred.id}`,
          `Type: ${cred.type}`,
          `Project: ${cred.project_name || cred.project}`,
        ];

        if (cred.description) lines.push(`Description: ${cred.description}`);
        if (cred.script_first_url) lines.push(`First URL: ${cred.script_first_url}`);

        if (cred.script_content) {
          lines.push('', '--- Playwright Script ---', '', cred.script_content);
        }

        if (cred.headers && cred.headers.length > 0) {
          lines.push('', 'Headers:');
          for (const h of cred.headers) {
            lines.push(`  ${h.name}: [REDACTED]`);
          }
        }

        if (cred.cookie && cred.cookie.length > 0) {
          lines.push('', 'Cookies:');
          for (const c of cred.cookie) {
            lines.push(`  ${c.name}: [REDACTED]`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join('\n') }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to get credential: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  /**
   * List Auth Credentials
   */
  registerNightVisionTool(server,
    "list-auth-credentials",
    ListAuthCredentialsParamsSchema,
    async (args, _extra) => {
      try {
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        if (args.project_id) {
          const projectAccess = await requireProjectAccess({
            project_id: args.project_id,
            action: 'listing auth credentials'
          });
          if (!projectAccess.ok) return projectAccess.response;
        }

        const projectIds = args.project_id ? [args.project_id] : undefined;
        const response = await nightvisionService.listCredentials(projectIds);
        const results = response?.results || response || [];

        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: "No credentials found." }] };
        }

        const lines = results.map((c: any) =>
          `- ${c.name} | ID: ${c.id} | Type: ${c.type} | Project: ${c.project_name || c.project}`
        );

        return {
          content: [{ type: "text" as const, text: `Credentials (${results.length}):\n\n${lines.join('\n')}` }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to list credentials: ${error.message}` }],
          isError: true
        };
      }
    }
  );
}
