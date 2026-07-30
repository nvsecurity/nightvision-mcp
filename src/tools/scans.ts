import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import {
  StartScanParamsSchema,
  ListScansParamsSchema,
  GetScanStatusParamsSchema,
  WaitForScanParamsSchema,
  ManagedScanProcessParamsSchema,
  GetScanChecksParamsSchema,
  SummarizeScanFindingsParamsSchema,
  GetScanPathsParamsSchema,
  ListCheckCategoriesParamsSchema
} from '../types/index.js';
import { getExclusionIds, getNucleiExclusionFolders, formatCheckList } from '../utils/check-catalog.js';
import { requireAuthenticatedUser, requireProjectAccess } from '../utils/auth-guard.js';
import { extractScanId } from '../utils/scan-id.js';
import { summarizeScanChecks } from '../utils/scan-findings-summary.js';
import { classifyScanStatus } from '../utils/scan-status.js';
import { jsonText } from '../utils/tool-response.js';
import { wrapUntrusted, neutralizeFenceMarkers } from '../utils/untrusted.js';
import { registerNightVisionTool } from './metadata.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown' | 'unspecified';
const DEFAULT_SEVERITIES: SeverityLevel[] = ['critical', 'high', 'medium', 'low'];
const DEFAULT_STATUSES: number[] = [0];

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
  registerNightVisionTool(server,
    "start-scan",
    StartScanParamsSchema,
    async (args, _extra) => {
      try {
        const {
          target_name: targetName,
          auth,
          auth_id,
          no_auth,
          project,
          project_id,
          force_private_scan = false,
          run_only_zap_checks,
          run_only_nuclei_folders
        } = args;
        
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;
        
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

        const projectAccess = await requireProjectAccess({
          project,
          project_id,
          action: 'starting a scan'
        });
        if (!projectAccess.ok) return projectAccess.response;
        
        // Resolve inclusion-based check selection into the exclusion lists the
        // CLI expects. Done synchronously so a bad selection fails fast rather
        // than silently in the background scan.
        let disableZapActiveAlerts: string[] | undefined;
        let disableNucleiFolders: string[] | undefined;
        if ((run_only_zap_checks && run_only_zap_checks.length > 0) ||
            (run_only_nuclei_folders && run_only_nuclei_folders.length > 0)) {
          try {
            const checks = await nightvisionService.getConfiguredChecks();

            if (run_only_zap_checks && run_only_zap_checks.length > 0) {
              const { excludeIds, matchedAlerts } = getExclusionIds(checks, run_only_zap_checks);
              if (matchedAlerts.length === 0) {
                return {
                  content: [{
                    type: "text" as const,
                    text: `No matching ZAP checks found for: ${run_only_zap_checks.join(', ')}.\n\nAvailable checks:\n${formatCheckList(checks)}`
                  }],
                  isError: true
                };
              }
              disableZapActiveAlerts = excludeIds;
            }

            if (run_only_nuclei_folders && run_only_nuclei_folders.length > 0) {
              const { excludeFolders, matchedFolders } = getNucleiExclusionFolders(checks, run_only_nuclei_folders);
              if (matchedFolders.length === 0) {
                return {
                  content: [{
                    type: "text" as const,
                    text: `No matching Nuclei folders found for: ${run_only_nuclei_folders.join(', ')}.\n\nAvailable checks:\n${formatCheckList(checks)}`
                  }],
                  isError: true
                };
              }
              disableNucleiFolders = excludeFolders;
            }
          } catch (error: any) {
            return {
              content: [{ type: "text" as const, text: `Failed to resolve check selection: ${error.message}` }],
              isError: true
            };
          }
        }

        try {
          console.error(`Starting scan for target '${targetName}'...`);
          const result = await nightvisionService.startManagedScan(
            targetName,
            {
              auth,
              auth_id,
              no_auth,
              project,
              project_id,
              force_private_scan,
              disable_zap_active_alerts: disableZapActiveAlerts,
              disable_nuclei_folders: disableNucleiFolders
            },
            'json'
          );
          const scanId = extractScanId(result);

          if (!scanId) {
            let parsedResult: any = null;
            try {
              parsedResult = JSON.parse(result);
            } catch {
              // Non-JSON CLI output; treated as a hard not-found below.
            }

            // The managed CLI relay is still running but the scan id has not
            // surfaced yet. Do NOT report failure: for private scans the process
            // IS the relay and is still alive. Return a running status with the
            // pending process key so the agent can poll and cancel if needed.
            if (parsedResult?.scan_id_pending) {
              return jsonText({
                ok: true,
                status: 'running',
                data: {
                  scan_id: null,
                  scan_id_pending: true,
                  pending_process_key: parsedResult.pending_process_key || null,
                  target_name: targetName,
                  project: project || null,
                  project_id: project_id || null,
                  cli_process: parsedResult.cli_process || null,
                  message: 'NightVision scan is starting and the CLI relay is running. Poll list-scans or list-managed-scan-processes to obtain the scan ID.'
                },
                warnings: ['Scan ID not yet reported. The managed CLI relay is still running; do not stop the MCP server for local/private scans until the scan reaches a terminal status.']
              });
            }

            return jsonText({
              ok: false,
              status: 'blocked',
              error: {
                code: 'SCAN_ID_NOT_FOUND',
                message: 'NightVision scan was started, but no scan ID was returned by the CLI or API.',
                details: { raw_output: neutralizeFenceMarkers(result) }
              },
              blockers: ['scan_id_not_found']
            });
          }

          let raw: unknown = result;
          try {
            raw = JSON.parse(result);
          } catch {
            // Keep raw string when CLI output is not JSON.
          }

          return jsonText({
            ok: true,
            status: 'success',
            data: {
              scan_id: scanId,
              target_name: targetName,
              project: project || null,
              project_id: project_id || null,
              auth: auth || null,
              auth_id: auth_id || null,
              no_auth: !!no_auth,
              force_private_scan: !!force_private_scan,
              raw
            }
          });
        } catch (error: any) {
          console.error(`Error starting scan: ${error.message}`);
          
          // Check for project-related errors
          if (error.message && error.message.includes("Project=")) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Project error: The project specified does not exist or you don't have permission to access it.\n\nYou MUST specify a valid project when starting a scan. Please try again with:\n\n{\n  "target_name": "${targetName}",\n  "project": "ceylan",\n  "format": "json"\n}\n\nYou can run the following command in your terminal to see available projects:\n$ nightvision project list\n\nError details: ${error.message}` 
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
                text: `Target not found: The target '${targetName}' was not found or you don't have permission to access it.\n\nPlease check that:\n1. The target name is spelled correctly\n2. The target exists in your account\n3. You have permission to access the target\n\nYou can run the following command in your terminal to list available targets:\n$ nightvision target list -p "${project || 'your-project'}"\n\nError details: ${error.message}` 
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
   * Wait for a scan to reach a terminal status.
   */
  registerNightVisionTool(server,
    "wait-for-scan",
    WaitForScanParamsSchema,
    async (args, _extra) => {
      try {
        // Defaults are supplied by WaitForScanParamsSchema (3600s / 30s); these
        // fallbacks only apply if the tool is ever called without zod-applied
        // args, so keep them aligned with the schema to avoid surprising drift.
        const {
          scan_id: scanId,
          timeout_seconds = 3600,
          poll_interval_seconds = 30
        } = args;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const startTime = Date.now();
        const timeoutMs = Math.max(0, timeout_seconds * 1000);
        const pollMs = Math.max(0, poll_interval_seconds * 1000);
        let lastStatus: unknown = null;

        let lastPollError: string | null = null;
        while (Date.now() - startTime <= timeoutMs) {
          let parsed: any;

          try {
            const raw = await nightvisionService.getScanStatus(scanId, 'json');
            parsed = JSON.parse(raw);
          } catch (error: any) {
            // A transient poll failure (network/5xx from getScanStatus, or a
            // partial/non-JSON status body) must not abort a potentially
            // hour-long wait. Record it and keep polling, matching the harness
            // waitForScan helper, instead of returning a terminal failure.
            lastPollError = error?.message || String(error);
            await sleep(pollMs);
            continue;
          }

          lastPollError = null;
          lastStatus = parsed;
          const state = classifyScanStatus(parsed);
          const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

          if (state === 'succeeded') {
            return jsonText({
              ok: true,
              status: 'success',
              data: {
                scan_id: scanId,
                terminal_status: 'succeeded',
                elapsed_seconds: elapsedSeconds,
                last_status: parsed
              }
            });
          }

          if (state === 'failed') {
            return jsonText({
              ok: false,
              status: 'blocked',
              error: {
                code: 'SCAN_FAILED',
                message: 'NightVision scan reached an unsuccessful terminal status.',
                details: { last_status: parsed }
              },
              blockers: ['scan_failed']
            });
          }

          await sleep(pollMs);
        }

        return jsonText({
          ok: false,
          status: 'blocked',
          error: {
            code: 'SCAN_TIMEOUT',
            message: 'NightVision scan did not complete before the wait timeout.',
            details: { last_status: lastStatus, last_poll_error: lastPollError }
          },
          blockers: ['scan_timeout']
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'error',
          error: {
            code: 'WAIT_FOR_SCAN_FAILED',
            message: `Failed to wait for NightVision scan: ${error.message}`
          }
        });
      }
    }
  );

  /**
   * List managed local/private scan CLI processes.
   */
  registerNightVisionTool(server,
    "list-managed-scan-processes",
    {},
    async (_args, _extra) => {
      try {
        const raw = nightvisionService.listManagedScanProcesses();
        return jsonText({
          ok: true,
          status: 'success',
          data: JSON.parse(raw)
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'error',
          error: {
            code: 'LIST_MANAGED_SCAN_PROCESSES_FAILED',
            message: `Failed to list managed NightVision scan processes: ${error.message}`
          }
        });
      }
    }
  );

  /**
   * Inspect one managed local/private scan CLI process.
   */
  registerNightVisionTool(server,
    "get-managed-scan-process",
    ManagedScanProcessParamsSchema,
    async (args, _extra) => {
      try {
        const raw = nightvisionService.getManagedScanProcess(args.scan_id);
        return jsonText({
          ok: true,
          status: 'success',
          data: JSON.parse(raw)
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'blocked',
          error: {
            code: 'MANAGED_SCAN_PROCESS_NOT_FOUND',
            message: error.message
          },
          blockers: ['managed_scan_process_not_found']
        });
      }
    }
  );

  /**
   * Cancel one managed local/private scan CLI process.
   */
  registerNightVisionTool(server,
    "cancel-managed-scan-process",
    ManagedScanProcessParamsSchema,
    async (args, _extra) => {
      try {
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const raw = nightvisionService.cancelManagedScanProcess(args.scan_id);
        return jsonText({
          ok: true,
          status: 'success',
          data: JSON.parse(raw)
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'blocked',
          error: {
            code: 'MANAGED_SCAN_PROCESS_NOT_FOUND',
            message: error.message
          },
          blockers: ['managed_scan_process_not_found']
        });
      }
    }
  );

  /**
   * List Scans Tool
   * 
   * Provides a tool to list all scans with optional filtering
   */
  registerNightVisionTool(server,
    "list-scans",
    ListScansParamsSchema,
    async (args, _extra) => {
      try {
        const { 
          target, 
          project, 
          project_id, 
          limit, 
          status, 
          format = 'json' 
        } = args;
        
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        if (project || project_id) {
          const projectAccess = await requireProjectAccess({
            project,
            project_id,
            action: 'listing scans'
          });
          if (!projectAccess.ok) return projectAccess.response;
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
  registerNightVisionTool(server,
    "get-scan-status",
    GetScanStatusParamsSchema,
    async (args, _extra) => {
      try {
        const { 
          scan_id: scanId, 
          target_name: targetName,
          project,
          format = 'json' 
        } = args;
        
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;
        
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
  registerNightVisionTool(server,
    "get-scan-checks",
    GetScanChecksParamsSchema,
    async (args, _extra) => {
      try {
        const {
          scan_id: scanId,
          page,
          page_size,
          name,
          check_kind,
          severity: severityArg,
          status: statusArg,
          format = 'json'
        } = args;

        // Destructuring defaults only apply to `undefined`. An explicitly passed
        // empty array must also fall back to the defaults, otherwise no filter is
        // sent and the API returns every severity/status unfiltered.
        const severity = Array.isArray(severityArg) && severityArg.length > 0
          ? severityArg
          : DEFAULT_SEVERITIES;
        const status = Array.isArray(statusArg) && statusArg.length > 0
          ? statusArg
          : DEFAULT_STATUSES;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

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
          
          // Return the formatted output. Scan checks carry attacker-influenceable
          // scan data (finding titles, evidence), so fence it as untrusted like
          // the sibling findings tools rather than returning it raw.
          return {
            content: [{
              type: "text" as const,
              text: wrapUntrusted(result)
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
   * Summarize scan findings for agent-friendly triage.
   */
  registerNightVisionTool(server,
    "summarize-scan-findings",
    SummarizeScanFindingsParamsSchema,
    async (args, _extra) => {
      try {
        const {
          scan_id: scanId,
          severity: severityArg,
          status: statusArg,
          page_size = 100,
          limit = 20
        } = args;

        const severity = Array.isArray(severityArg) && severityArg.length > 0
          ? severityArg
          : DEFAULT_SEVERITIES;
        const status = Array.isArray(statusArg) && statusArg.length > 0
          ? statusArg
          : DEFAULT_STATUSES;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const raw = await nightvisionService.getScanChecks(
          scanId,
          {
            page_size,
            severity,
            status
          },
          'json'
        );

        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch (error: any) {
          return jsonText({
            ok: false,
            status: 'error',
            error: {
              code: 'SCAN_FINDINGS_PARSE_ERROR',
              message: `Could not parse NightVision scan findings as JSON: ${error.message}`,
              details: { raw_output: neutralizeFenceMarkers(raw) }
            }
          });
        }

        return jsonText({
          ok: true,
          status: 'success',
          data: {
            scan_id: scanId,
            filters: {
              severity,
              status,
              page_size,
              limit
            },
            summary: wrapUntrusted(JSON.stringify(summarizeScanChecks(parsed, limit), null, 2))
          }
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'error',
          error: {
            code: 'SUMMARIZE_SCAN_FINDINGS_FAILED',
            message: `Failed to summarize NightVision scan findings: ${error.message}`
          }
        });
      }
    }
  );

  /**
   * Get paths that have been checked during a scan
   */
  registerNightVisionTool(server,
    "get-scan-paths",
    GetScanPathsParamsSchema,
    async (args, _extra) => {
      try {
        const { scan_id, page, page_size, filter, format } = args;
        
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;
        
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

  /**
   * List Check Categories Tool
   *
   * Lists all available vulnerability checks (ZAP alerts and Nuclei folders)
   * that can be used with the run_only_zap_checks / run_only_nuclei_folders
   * parameters of start-scan. Fetched dynamically from the API.
   */
  registerNightVisionTool(server,
    "list-check-categories",
    ListCheckCategoriesParamsSchema,
    async (_args, _extra) => {
      try {
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const checks = await nightvisionService.getConfiguredChecks();
        return {
          content: [{
            type: "text" as const,
            text: `Available checks for run_only_zap_checks / run_only_nuclei_folders:\n\n${formatCheckList(checks)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error fetching check categories: ${error.message}` }],
          isError: true
        };
      }
    }
  );
}
