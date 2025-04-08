import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { 
  StartScanParamsSchema, 
  ListScansParamsSchema,
  GetScanStatusParamsSchema,
  GetScanChecksParamsSchema,
  GetScanPathsParamsSchema
} from '../types/index.js';

/**
 * Register scan-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerScanTools(server: McpServer): void {
  /**
   * Start Scan Tool
   * 
   * Provides a tool to initiate a scan on a NightVision target.
   * The tool is non-blocking and returns immediately with the scan ID.
   */
  server.tool(
    "start-scan",
    StartScanParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          target_name: targetName, 
          auth, 
          auth_id, 
          no_auth, 
          project, 
          project_id, 
          format = 'json' 
        } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
        // Check if project is provided (required)
        if (!project && !project_id) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "You must specify a project when starting a scan. Please include either the 'project' or 'project_id' parameter." 
            }],
            isError: true
          };
        }
        
        try {
          // Return immediately with confirmation message
          // Don't wait for the scan to actually start
          console.error(`Starting scan for target '${targetName}' in background...`);
          
          // Start the scan asynchronously, but don't wait for result
          setTimeout(() => {
            nightvisionService.startScan(
              targetName,
              { auth, auth_id, no_auth, project, project_id },
              format
            ).then(result => {
              // Try to extract scan ID for better UX
              let scanId = '';
              try {
                const resultObj = JSON.parse(result);
                if (resultObj.id || resultObj.extracted_id) {
                  scanId = resultObj.extracted_id || resultObj.id;
                  console.error(`Scan started with ID: ${scanId}`);
                }
              } catch (parseError) {
                console.error(`Could not parse scan result: ${parseError}`);
              }
              
              // Log the result but don't wait for it
              console.error(`Scan started successfully in background: ${result.substring(0, 100)}...`);
            }).catch(err => {
              // Just log errors, don't propagate to response
              console.error(`Error in background scan execution: ${err.message}`);
            });
          }, 0);
          
          // Return immediately with confirmation message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Scan initiated for target '${targetName}'.\n\nThe scan is being processed in the background and may take several minutes to complete.\n\nTo check the status of this scan, you can use the get-scan-status tool in either of these ways:\n\n1. Using the target name:\n   {\n     "target_name": "${targetName}",\n     "project": "${project || ''}"${project_id ? ',\n     "project_id": "' + project_id + '"' : ''}\n   }\n\n2. Or when the scan ID becomes available, you can use:\n   {\n     "scan_id": "scan-id-here"\n   }\n\nYou can also list all your scans with the list-scans tool.` 
            }]
          };
        } catch (error: any) {
          console.error(`Error starting scan: ${error.message}`);
          
          // Check for project-related errors
          if (error.message && error.message.includes("Project=")) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Project error: The project specified does not exist or you don't have permission to access it.\n\nYou MUST specify a valid project when starting a scan. Please try again with:\n\n{\n  "target_name": "${targetName}",\n  "project": "ceylan",\n  "format": "json"\n}\n\nYou can run the following command in your terminal to see available projects:\n\$ nightvision project list\n\nError details: ${error.message}` 
              }],
              isError: true
            };
          }
          
          // Check for target not found errors
          if (error.message && (
              error.message.includes("not found") || 
              error.message.includes("does not exist")
          )) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Target not found: The target '${targetName}' was not found or you don't have permission to access it.\n\nPlease check that:\n1. The target name is spelled correctly\n2. The target exists in your account\n3. You have permission to access the target\n\nYou can run the following command in your terminal to list available targets:\n\$ nightvision target list -p "${project || 'your-project'}"\n\nError details: ${error.message}` 
              }],
              isError: true
            };
          }
          
          // Return the general error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to start scan: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to start scan: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * List Scans Tool
   * 
   * Provides a tool to list all scans with optional filtering
   */
  server.tool(
    "list-scans",
    ListScansParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          target, 
          project, 
          project_id, 
          limit, 
          status, 
          format = 'json' 
        } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
        try {
          // Get the list of scans
          const result = await nightvisionService.listScans(
            {
              target,
              project,
              project_id,
              limit,
              status
            },
            format
          );
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: result 
            }]
          };
        } catch (error: any) {
          console.error(`Error listing scans: ${error.message}`);
          
          // Return a simplified error message without the project requirement
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to list scans: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to list scans: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Scan Status Tool
   * 
   * Provides a tool to check the status of a specific scan
   */
  server.tool(
    "get-scan-status",
    GetScanStatusParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          scan_id: scanId, 
          target_name: targetName,
          project,
          format = 'json' 
        } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
        // Validate that either scan_id or target_name is provided
        if (!scanId && !targetName) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Either scan_id or target_name is required. Please provide one of these parameters." 
            }],
            isError: true
          };
        }
        
        try {
          let result: string;
          
          if (scanId) {
            // If scan ID is provided, get the specific scan
            result = await nightvisionService.getScanStatus(scanId, format);
          } else {
            // If target name is provided, find the latest scan for that target
            console.error(`Looking up latest scan for target: ${targetName}`);
            
            try {
              // Get the list of scans for this target
              const scanList = await nightvisionService.listScans(
                {
                  target: targetName,
                  project,
                  // Limit to recent scans
                  limit: 10
                },
                'json'
              );
              
              // Parse the scan list
              const scans = JSON.parse(scanList);
              
              if (!scans.results || scans.results.length === 0) {
                return {
                  content: [{ 
                    type: "text" as const, 
                    text: `No scans found for target '${targetName}'. Please check that you have run a scan for this target recently.` 
                  }],
                  isError: true
                };
              }
              
              // Sort by created date (newest first) and get the first scan
              const latestScan = scans.results.sort((a: any, b: any) => {
                return new Date(b.created).getTime() - new Date(a.created).getTime();
              })[0];
              
              // Now get the details for this scan
              result = await nightvisionService.getScanStatus(latestScan.id, format);
              
              // Add a note that we're showing the latest scan
              if (format === 'json') {
                const resultObj = JSON.parse(result);
                resultObj.note = `This is the latest scan for target '${targetName}' (created: ${latestScan.created})`;
                result = JSON.stringify(resultObj, null, 2);
              } else if (format === 'table') {
                result = `Note: This is the latest scan for target '${targetName}' (created: ${latestScan.created})\n\n${result}`;
              }
            } catch (lookupError: any) {
              return {
                content: [{ 
                  type: "text" as const, 
                  text: `Failed to find latest scan for target '${targetName}': ${lookupError.message}` 
                }],
                isError: true
              };
            }
          }
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: result 
            }]
          };
        } catch (error: any) {
          console.error(`Error getting scan status: ${error.message}`);
          
          // Check if scan not found
          if (error.message && (
              error.message.includes("not found") || 
              error.message.includes("does not exist")
          )) {
            if (scanId) {
              return {
                content: [{ 
                  type: "text" as const, 
                  text: `Scan not found: The scan with ID '${scanId}' was not found or you don't have permission to access it.\n\nPlease check that the scan ID is correct and that you have access to the project containing this scan.` 
                }],
                isError: true
              };
            } else {
              return {
                content: [{ 
                  type: "text" as const, 
                  text: `No scans found for target '${targetName}'. Please check that the target name is correct and that you have run a scan for this target.` 
                }],
                isError: true
              };
            }
          }
          
          // Return a helpful error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to get scan status: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to get scan status: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Scan Checks Tool
   * 
   * Provides a tool to retrieve vulnerabilities and check results for a specific scan
   */
  server.tool(
    "get-scan-checks",
    GetScanChecksParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          scan_id: scanId,
          page,
          page_size,
          name,
          check_kind,
          severity,
          status,
          format = 'json'
        } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
        // Verify required parameters
        if (!severity || !Array.isArray(severity) || severity.length === 0) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Severity parameter is required and must be an array of severity values." 
            }],
            isError: true
          };
        }
        
        if (!status || !Array.isArray(status) || status.length === 0) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Status parameter is required and must be an array of status codes (0, 1, 2, 3)." 
            }],
            isError: true
          };
        }
        
        try {
          // Get the scan vulnerabilities
          const result = await nightvisionService.getScanChecks(
            scanId,
            {
              page,
              page_size,
              name,
              check_kind,
              severity,
              status
            },
            format
          );
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: result 
            }]
          };
        } catch (error: any) {
          console.error(`Error getting scan checks: ${error.message}`);
          
          // Check if scan not found
          if (error.message && (
              error.message.includes("not found") || 
              error.message.includes("does not exist")
          )) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Scan not found: The scan with ID '${scanId}' was not found or you don't have permission to access it.\n\nPlease check that the scan ID is correct and that you have access to the project containing this scan.` 
              }],
              isError: true
            };
          }
          
          // Return a helpful error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to get scan vulnerabilities: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to get scan vulnerabilities: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Get paths that have been checked during a scan
   */
  server.tool(
    "get-scan-paths",
    GetScanPathsParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { scan_id, page, page_size, filter, format } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
        // Verify required parameter
        if (!scan_id) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Scan ID is required. Please provide a 'scan_id' parameter with the UUID of the scan." 
            }],
            isError: true
          };
        }
        
        // Get scan paths
        const output = await nightvisionService.getScanPaths(
          scan_id,
          {
            page,
            page_size,
            filter
          },
          format || "json"
        );
        
        return {
          content: [{ 
            type: "text" as const, 
            text: output 
          }]
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Error getting scan paths: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );
} 