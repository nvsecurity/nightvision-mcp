import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { saveToken, clearToken } from '../config/token.js';
import { AuthenticateParamsSchema } from '../types/index.js';
import { ENVIRONMENT } from '../config/environment.js';

/**
 * Register authentication-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerAuthTools(server: McpServer): void {
  server.tool(
    "authenticate",
    AuthenticateParamsSchema,
    async (args: any, _extra: any) => {
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
            
            // Verify the token works 
            const isValid = await nightvisionService.verifyProductionAuth();
            if (!isValid) {
              return {
                content: [{ 
                  type: "text" as const, 
                  text: `Created a new token (starts with: ${newToken.substring(0, 8)}...) but it couldn't be validated.\n\nThe login process may not have completed successfully. Please try again or run the following command in your terminal:\nnightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}` 
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
                text: `Failed to create new token: ${error.message}\n\nThe NightVision CLI requires an interactive login session. Please run the following command in your terminal:\nnightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}` 
              }],
              isError: true
            };
          }
        }
        
        // Using a provided token
        if (token) {
          nightvisionService.setToken(token);
          saveToken(token);
          
          // Validate the token
          try {
            const isValid = await nightvisionService.verifyProductionAuth();
            if (!isValid) {
              nightvisionService.setToken(null);
              clearToken();
              return {
                content: [{ 
                  type: "text" as const, 
                  text: `The provided token is not valid.\n\nPlease run the following command and then try again:\nnightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}` 
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
          } catch (error) {
            nightvisionService.setToken(null); // Reset if validation fails
            clearToken();
            return {
              content: [{ 
                type: "text" as const, 
                text: `Authentication failed: Invalid token.` 
              }],
              isError: true
            };
          }
        }
        
        // Check authentication status if no parameters provided
        if (!token && !create_new) {
          const currentToken = nightvisionService.getToken();
          if (currentToken) {
            // Verify the token works
            const isValid = await nightvisionService.verifyProductionAuth();
            if (isValid) {
              return {
                content: [{ 
                  type: "text" as const, 
                  text: `Authenticated successfully. Token starts with: ${currentToken.substring(0, 8)}...` 
                }]
              };
            } else {
              return {
                content: [{ 
                  type: "text" as const, 
                  text: `You have a token (starts with: ${currentToken.substring(0, 8)}...) but it appears to be invalid or expired.\n\nPlease run the following command and then try again:\nnightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}` 
                }],
                isError: true
              };
            }
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
} 