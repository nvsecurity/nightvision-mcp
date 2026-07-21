import { serializeRepeatedParams } from '../utils/query-params.js';
import { scanStatusFilterCodes } from '../utils/scan-status.js';
import { extractScanId } from '../utils/scan-id.js';
import type { ConfiguredChecks } from '../utils/check-catalog.js';
import { formatScanChecksText, formatScanChecksTable } from '../utils/scan-check-format.js';
import { formatScansTable } from '../utils/scan-list-format.js';
import { formatScanPathsText, formatScanPathsTable } from '../utils/scan-path-format.js';
import { ENVIRONMENT } from '../config/environment.js';
import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tail = (value: string, max = 8_000) => value.length > max ? value.slice(-max) : value;

// Cap how much CLI output we retain per managed scan. A verbose multi-hour scan
// would otherwise grow these accumulators without bound; we only ever need the
// most recent output for scan-ID parsing and diagnostics.
const MAX_OUTPUT_CHARS = 64_000;
const appendBounded = (existing: string, chunk: string): string => {
  const next = existing + chunk;
  return next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next;
};

// Cap how many managed-scan records we keep. Oldest completed records are
// evicted first so a long-lived MCP server does not accumulate ChildProcess
// references and history indefinitely.
const MAX_MANAGED_PROCESSES = 50;

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Minimal resolution surface ScanService needs to turn target/project names
 * into ids. Supplied by the facade so name-resolution stays interceptable
 * (the facade routes these through its own public methods).
 */
export interface ScanResolver {
  resolveTargetId(name: string, project?: string, projectId?: string): Promise<string>;
  getProjectByName(projectName: string): Promise<any>;
}

interface ManagedScanProcess {
  scan_id: string;
  scan_id_pending: boolean;
  target_name: string;
  project: string | null;
  project_id: string | null;
  pid: number | null;
  command: string[];
  started_at: string;
  completed_at: string | null;
  exited: boolean;
  exit_code: number | null;
  exit_signal: NodeJS.Signals | null;
  stdout_tail: string;
  stderr_tail: string;
  child: ChildProcessWithoutNullStreams;
}

/**
 * Options that map to `nightvision scan` CLI flags, shared by the direct and
 * managed scan paths so the flag set is defined in one place.
 */
export interface ScanCliOptions {
  auth?: string;
  auth_id?: string;
  no_auth?: boolean;
  project?: string;
  project_id?: string;
  force_private_scan?: boolean;
  disable_zap_active_alerts?: string[];
  disable_nuclei_folders?: string[];
}

/**
 * Build the `nightvision scan <target> ...` argument vector from the shared scan
 * options. Both startScan and startManagedScan use this so the flags and their
 * order stay identical between the two paths.
 */
function buildScanArgs(targetName: string, options: ScanCliOptions): string[] {
  const args = ['scan', targetName];
  if (options.auth) args.push('-c', options.auth);
  if (options.auth_id) args.push('-C', options.auth_id);
  if (options.no_auth) args.push('--no-auth');
  if (options.project) args.push('-p', options.project);
  if (options.project_id) args.push('-P', options.project_id);
  if (options.force_private_scan) args.push('--force-private-scan');
  if (options.disable_zap_active_alerts && options.disable_zap_active_alerts.length > 0) {
    args.push('--disable-zap-active-alerts', options.disable_zap_active_alerts.join(','));
  }
  if (options.disable_nuclei_folders && options.disable_nuclei_folders.length > 0) {
    args.push('--disable-nuclei-folders', options.disable_nuclei_folders.join(','));
  }
  return args;
}

/**
 * Scan lifecycle, status, checks and paths.
 */
export class ScanService {
  private cachedChecks: ConfiguredChecks | null = null;
  private managedScanProcesses = new Map<string, ManagedScanProcess>();

  constructor(private client: ApiClient, private resolver: ScanResolver) {}

  /**
   * Start a scan against a target
   * @param targetName Name of the target to scan
   * @param options Additional options for scan
   * @param format Output format
   * @returns Scan information
   */
  async startScan(
    targetName: string,
    options: ScanCliOptions = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    // We won't try to auto-detect the project
    // Users should provide project info explicitly

    const args = buildScanArgs(targetName, options);

    // Execute the command with standard parameters
    const result = await this.client.executeCommand(args, format);

    // Try to extract the scan ID from the CLI output if it's in JSON format
    if (format === 'json') {
      try {
        const resultObj = JSON.parse(result);
        if (resultObj.id) {
          console.error(`Extracted scan ID: ${resultObj.id}`);
          // Add the scan ID explicitly to the output for better UX
          resultObj.extracted_id = resultObj.id;
          return JSON.stringify(resultObj, null, 2);
        }
      } catch (parseError) {
        console.error(`Could not parse JSON result to extract scan ID: ${parseError}`);
        // Just fall through to the extractScanId recovery below.
      }

      // `nightvision scan -F json` streams text progress blocks that do not parse
      // as a single JSON object with an .id, so the block above frequently throws
      // or finds no id. Fall back to extractScanId, which recovers the id from
      // JSON, labeled "Scan ID:" output, and bare-uuid forms.
      const extractedId = extractScanId(result);
      if (extractedId) {
        console.error(`Extracted scan ID: ${extractedId}`);
        return JSON.stringify({ extracted_id: extractedId, raw: result }, null, 2);
      }
    }

    return result;
  }

  /**
   * Start a scan with a managed CLI process. The CLI can stay alive for
   * localhost/internal targets while it runs the Smart Proxy relay. This method
   * returns once the API exposes the scan id and keeps the CLI process alive in
   * the service process.
   */
  async startManagedScan(
    targetName: string,
    options: ScanCliOptions = {},
    format: OutputFormat = 'json',
    timeoutMs = 120_000
  ): Promise<string> {
    const args = buildScanArgs(targetName, options);

    const commandArgs = [...args, '-F', format, '--api-url', ENVIRONMENT.CURRENT_API_URL];
    const env = { ...process.env };
    const token = this.client.getToken();
    if (token) {
      env.NIGHTVISION_TOKEN = token;
    }

    // Snapshot existing scans BEFORE launch so the started scan is identified as
    // the id that was not already present (immune to clock skew and to a target
    // that already had a recent scan). startedAfter is captured pre-spawn too, as
    // the fallback window when the baseline listing is unavailable.
    const baselineIds = await this.snapshotScanIds(targetName, options);
    const startedAfter = Date.now();

    const cliPath = ENVIRONMENT.NIGHTVISION_CLI_PATH;
    console.error(`Executing managed scan: ${[cliPath, ...commandArgs].join(' ')}`);
    const child = spawn(cliPath, commandArgs, { env });
    let stdout = '';
    let stderr = '';
    let exitCode: number | null | undefined;
    let exitSignal: NodeJS.Signals | null | undefined;
    const spawnState: { errorMessage?: string } = {};

    // Register the process immediately under a synthetic pending key so it is
    // trackable and cancellable even before a scan id is known. When the id is
    // discovered the record is re-keyed to the real scan id.
    const startedAt = new Date().toISOString();
    const pendingKey = `pending-${child.pid ?? 'unknown'}-${startedAfter}`;
    let trackedKey: string = pendingKey;
    this.managedScanProcesses.set(pendingKey, {
      scan_id: pendingKey,
      scan_id_pending: true,
      target_name: targetName,
      project: options.project || null,
      project_id: options.project_id || null,
      pid: child.pid ?? null,
      command: [cliPath, ...commandArgs],
      started_at: startedAt,
      completed_at: null,
      exited: false,
      exit_code: null,
      exit_signal: null,
      stdout_tail: '',
      stderr_tail: '',
      child
    });
    // Enforce the eviction cap on the pending-insert path too. Without this, a
    // scan that never surfaces an id (the pending return below) would leave its
    // record behind while only rememberScan() prunes, so repeated pending starts
    // could grow the map past MAX_MANAGED_PROCESSES. pruneManagedProcesses only
    // evicts already-exited records, so the live relay just inserted is safe.
    this.pruneManagedProcesses();

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk.toString());
      const info = this.managedScanProcesses.get(trackedKey);
      if (info) info.stdout_tail = tail(stdout);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = appendBounded(stderr, text);
      const info = this.managedScanProcesses.get(trackedKey);
      if (info) info.stderr_tail = tail(stderr);
      console.error(`NightVision scan process: ${text.trim()}`);
    });
    child.on('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      const info = this.managedScanProcesses.get(trackedKey);
      if (info) {
        info.exited = true;
        info.exit_code = code;
        info.exit_signal = signal;
        info.completed_at = new Date().toISOString();
        info.stdout_tail = tail(stdout);
        info.stderr_tail = tail(stderr);
      }
      console.error(`NightVision scan process exited: code=${code} signal=${signal}`);
    });
    child.on('error', (error) => {
      spawnState.errorMessage = error.message;
      console.error(`NightVision scan process failed to start: ${error.message}`);
    });

    const deadline = Date.now() + timeoutMs;
    const POLL_MS = 250; // cheap in-memory stdout check cadence
    const LIST_INTERVAL_MS = 2_000; // network list-scans lookup cadence
    let lastListAt = 0;
    const rememberScan = (scanId: string, raw?: unknown) => {
      const exited = exitCode !== undefined || exitSignal !== undefined;
      // Re-key the pending record to the real scan id.
      const existing = this.managedScanProcesses.get(trackedKey);
      this.managedScanProcesses.delete(trackedKey);
      trackedKey = scanId;
      this.managedScanProcesses.set(scanId, {
        scan_id: scanId,
        scan_id_pending: false,
        target_name: targetName,
        project: options.project || null,
        project_id: options.project_id || null,
        pid: child.pid ?? null,
        command: [cliPath, ...commandArgs],
        started_at: startedAt,
        completed_at: exited ? (existing?.completed_at ?? new Date().toISOString()) : null,
        exited,
        exit_code: exitCode ?? null,
        exit_signal: exitSignal ?? null,
        stdout_tail: tail(stdout),
        stderr_tail: tail(stderr),
        child
      });
      this.pruneManagedProcesses();
      return this.managedScanResult(scanId, targetName, options, child, exited, raw, false);
    };

    while (Date.now() < deadline) {
      if (spawnState.errorMessage) {
        // The CLI never launched; drop the untracked pending record.
        this.managedScanProcesses.delete(trackedKey);
        throw new Error(`Failed to start NightVision scan command: ${spawnState.errorMessage}`);
      }

      // Cheap: parse the scan id straight out of CLI stdout as soon as it appears.
      const fromOutput = this.extractScanIdFromOutput(stdout);
      if (fromOutput) {
        return rememberScan(fromOutput);
      }

      // Costly (network): only poll list-scans every LIST_INTERVAL_MS.
      if (Date.now() - lastListAt >= LIST_INTERVAL_MS) {
        lastListAt = Date.now();
        const fromList = await this.findNewScanForTarget(targetName, options, baselineIds, startedAfter);
        if (fromList?.id) {
          return rememberScan(fromList.id, fromList);
        }
      }

      // A non-zero exit before an id means the scan genuinely failed to start.
      if (exitCode !== undefined && exitCode !== 0) {
        this.managedScanProcesses.delete(trackedKey);
        throw new Error(`NightVision scan command exited before a scan ID was available: ${stderr || stdout}`);
      }

      // A clean exit (code 0) with no id yet: the process may have printed the
      // scan id and exited in the same tick, so let stdout drain and re-check
      // (output, then one final list lookup) before giving up, rather than
      // spinning to the full timeout on an already-finished process.
      if (exitCode === 0) {
        await sleep(50);
        const afterExit = this.extractScanIdFromOutput(stdout);
        if (afterExit) {
          return rememberScan(afterExit);
        }
        const finalLook = await this.findNewScanForTarget(targetName, options, baselineIds, startedAfter);
        if (finalLook?.id) {
          return rememberScan(finalLook.id, finalLook);
        }
        break;
      }

      await sleep(POLL_MS);
    }

    // We could not determine a scan id in time. Crucially, do NOT kill the child:
    // for private/Smart Proxy scans the CLI process IS the scan relay, so killing
    // it would abort the very scan we started. Leave it running and tracked under
    // the pending key so the agent can poll and, if needed, cancel it explicitly.
    return this.managedScanResult(
      pendingKey,
      targetName,
      options,
      child,
      exitCode !== undefined || exitSignal !== undefined,
      { note: 'scan_id_pending', stdout_tail: tail(stdout), stderr_tail: tail(stderr) },
      true
    );
  }

  listManagedScanProcesses(): string {
    return JSON.stringify({
      results: [...this.managedScanProcesses.values()].map((process) => this.serializeManagedProcess(process, false))
    }, null, 2);
  }

  getManagedScanProcess(scanId: string): string {
    const process = this.managedScanProcesses.get(scanId);
    if (!process) {
      throw new Error(`No managed NightVision scan process found for scan ID: ${scanId}`);
    }
    return JSON.stringify(this.serializeManagedProcess(process, true), null, 2);
  }

  cancelManagedScanProcess(scanId: string): string {
    const process = this.managedScanProcesses.get(scanId);
    if (!process) {
      throw new Error(`No managed NightVision scan process found for scan ID: ${scanId}`);
    }

    const wasRunning = !process.exited;
    if (wasRunning) {
      process.child.kill('SIGTERM');
    }

    return JSON.stringify({
      scan_id: scanId,
      cancelled: wasRunning,
      process: this.serializeManagedProcess(process, true)
    }, null, 2);
  }

  private serializeManagedProcess(process: ManagedScanProcess, includeOutput: boolean): Record<string, unknown> {
    return {
      scan_id: process.scan_id,
      scan_id_pending: process.scan_id_pending,
      target_name: process.target_name,
      project: process.project,
      project_id: process.project_id,
      pid: process.pid,
      command: process.command,
      started_at: process.started_at,
      completed_at: process.completed_at,
      exited: process.exited,
      exit_code: process.exit_code,
      exit_signal: process.exit_signal,
      ...(includeOutput ? {
        stdout_tail: process.stdout_tail,
        stderr_tail: process.stderr_tail
      } : {})
    };
  }

  private managedScanResult(
    scanId: string,
    targetName: string,
    options: { project?: string; project_id?: string },
    child: ChildProcessWithoutNullStreams,
    exited: boolean,
    raw?: unknown,
    scanIdPending = false
  ): string {
    return JSON.stringify({
      // When the scan id is still pending we deliberately return id: null so the
      // caller does not mistake the synthetic pending key for a real scan id.
      id: scanIdPending ? null : scanId,
      extracted_id: scanIdPending ? null : scanId,
      scan_id_pending: scanIdPending,
      pending_process_key: scanIdPending ? scanId : null,
      target_name: targetName,
      project: options.project || null,
      project_id: options.project_id || null,
      raw: raw ?? null,
      cli_process: {
        pid: child.pid ?? null,
        managed: true,
        exited
      }
    }, null, 2);
  }

  private extractScanIdFromOutput(output: string): string | null {
    // Prefer a clean JSON payload from `-F json`.
    try {
      const parsed = JSON.parse(output);
      const fromJson = parsed?.id || parsed?.scan_id || parsed?.scanId || parsed?.extracted_id;
      if (fromJson) return fromJson;
    } catch {
      // Not JSON (or partial buffer); fall through to labeled-text parsing.
    }

    // Only accept a UUID that is explicitly labeled as a scan id, or that appears
    // in a scans/<uuid> API path. A bare "first UUID anywhere" match is unsafe
    // because CLI progress output prints target/project/credential UUIDs too; in
    // that case we return null and let the list-scans baseline diff find the real
    // scan id instead. The leading \b keeps a label like "target_scan_id=<uuid>"
    // or "rescan_id=<uuid>" from matching the "scan_id" substring.
    const labeled = output.match(new RegExp(`\\bscan[_-]?id["']?\\s*[:=]\\s*["']?(${UUID_RE})`, 'i'));
    if (labeled) return labeled[1];

    const urlPath = output.match(new RegExp(`scans/(${UUID_RE})`, 'i'));
    if (urlPath) return urlPath[1];

    return null;
  }

  private async listScansForTarget(
    targetName: string,
    options: { project?: string; project_id?: string }
  ): Promise<any[]> {
    const raw = await this.listScans(
      {
        target: targetName,
        project: options.project,
        project_id: options.project_id,
        status: 'all',
        limit: 25
      },
      'json'
    );
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
  }

  /**
   * Snapshot the scan ids that already exist for a target BEFORE we launch a new
   * one. The started scan is later identified as the id that was not in this
   * baseline, which is immune to clock skew and to pre-existing recent scans.
   * Best-effort: a listing failure yields null and the caller falls back to a
   * timestamp window.
   */
  private async snapshotScanIds(
    targetName: string,
    options: { project?: string; project_id?: string }
  ): Promise<Set<string> | null> {
    try {
      const results = await this.listScansForTarget(targetName, options);
      return new Set(results.map((scan: any) => scan.id).filter(Boolean));
    } catch (error: any) {
      console.error(`Could not snapshot existing scans for target "${targetName}": ${error.message}`);
      return null;
    }
  }

  private scanCreatedAt(scan: any): number {
    return Date.parse(scan.created_at || scan.created || scan.started_at || '');
  }

  /**
   * Find the scan that this launch created. If we have a pre-launch baseline of
   * scan ids, the new scan is simply the newest id not in that baseline. Without
   * a baseline (listing failed pre-launch) we fall back to a strict timestamp
   * window: only scans with a parseable created_at at/after launch qualify, so a
   * pre-existing or timestamp-less scan is never mistaken for the new one.
   */
  private async findNewScanForTarget(
    targetName: string,
    options: { project?: string; project_id?: string },
    baselineIds: Set<string> | null,
    startedAfter: number
  ): Promise<any | null> {
    try {
      const results = await this.listScansForTarget(targetName, options);
      const candidates = results.filter((scan: any) => {
        if (!scan.id) return false;
        if (baselineIds) return !baselineIds.has(scan.id);
        const createdAt = this.scanCreatedAt(scan);
        return Number.isFinite(createdAt) && createdAt >= startedAfter;
      });
      return candidates.sort((a: any, b: any) =>
        (this.scanCreatedAt(b) || 0) - (this.scanCreatedAt(a) || 0)
      )[0] || null;
    } catch (error: any) {
      console.error(`Could not find new scan for target "${targetName}": ${error.message}`);
      return null;
    }
  }

  private pruneManagedProcesses(): void {
    if (this.managedScanProcesses.size <= MAX_MANAGED_PROCESSES) return;
    const evictable = [...this.managedScanProcesses.values()]
      .filter((proc) => proc.exited)
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    while (this.managedScanProcesses.size > MAX_MANAGED_PROCESSES && evictable.length > 0) {
      const oldest = evictable.shift()!;
      this.managedScanProcesses.delete(oldest.scan_id);
    }
  }

  /**
   * List all scans
   * @param options Additional options for filtering scans
   * @param format Output format
   * @returns List of scans
   */
  async listScans(
    options: {
      target?: string;
      project?: string;
      project_id?: string;
      limit?: number;
      status?: 'running' | 'finished' | 'failed' | 'all';
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // Use API endpoint instead of CLI - based on https://docs.nightvision.net/reference/scans_list
      console.error(`Listing scans via API endpoint...`);

      // Build query parameters. The scans endpoint scopes by `target` and
      // `project`, each a repeated-key list of UUIDs (NV-4468); the by-name
      // inputs are resolved to ids before the request.
      const params: Record<string, any> = {};

      if (options.target) {
        const targetId = await this.resolver.resolveTargetId(
          options.target,
          options.project,
          options.project_id
        );
        params.target = [targetId];
      }

      // Project scoping: a project UUID maps straight through; a project name is
      // resolved to its id.
      if (options.project_id) {
        params.project = [options.project_id];
      } else if (options.project) {
        const project = await this.resolver.getProjectByName(options.project);
        params.project = [project.id];
      }

      if (options.limit) {
        params.limit = options.limit;
      }

      // The scans API filters on numeric status codes through a multi-valued
      // field, not these coarse names; map each name to the matching code(s).
      if (options.status && options.status !== 'all') {
        params.status = scanStatusFilterCodes(options.status);
      }

      // Make API request to list scans. Status codes must be sent as repeated
      // `status=` params, so use the repeated-key serializer for this call.
      const response = await this.client.apiRequest<any>(
        'scans/',
        'GET',
        params,
        null,
        false,
        serializeRepeatedParams
      );

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        return formatScansTable(response);
      }

      // Default to just returning the raw data as string
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error listing scans: ${error.message}`);
      throw new Error(`Failed to list scans: ${error.message}`);
    }
  }

  /**
   * Get scan status and details
   * @param scanId Scan ID to retrieve
   * @param format Output format
   * @returns Scan details
   */
  async getScanStatus(
    scanId: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // API-based approach using the scan details endpoint
      console.error(`Getting scan status via API endpoint...`);

      // Make API request to get scan details
      const response = await this.client.apiRequest<any>(
        `scans/${encodeURIComponent(scanId)}/`,
        'GET'
      );

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        // Create a simple table with the key information
        const details = [
          ['ID', response.id || 'N/A'],
          ['Target', response.target?.name || 'N/A'],
          ['Status', response.status || 'N/A'],
          ['Created', response.created || 'N/A'],
          ['Started', response.started || 'N/A'],
          ['Completed', response.completed || 'N/A'],
          ['Project', response.project?.name || 'N/A'],
          ['Progress', `${response.progress || 0}%`]
        ];

        // Format as a table
        return details.map(([key, value]) => `${key}: ${value}`).join('\n');
      }

      // Default to returning raw JSON
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error getting scan status: ${error.message}`);
      throw new Error(`Failed to get scan status: ${error.message}`);
    }
  }

  /**
   * Get vulnerability checks for a scan
   * @param scanId ID of the scan to get checks for
   * @param options Additional options for filtering checks
   * @param format Output format
   * @returns List of vulnerability checks
   */
  async getScanChecks(
    scanId: string,
    options: {
      page?: number;
      page_size?: number;
      name?: string;
      check_kind?: string;
      severity: Array<'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown' | 'unspecified'>;
      status: Array<number>;
    },
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // Use API endpoint
      console.error(`Getting scan checks for ${scanId} via API endpoint...`);

      // Build query parameters
      const params: Record<string, any> = {};

      if (options.page) {
        params.page = options.page;
      }

      // Set page_size with default of 100 if not specified
      params.page_size = options.page_size || 100;

      if (options.name) {
        params.name = options.name;
      }

      if (options.check_kind) {
        params.check_kind = options.check_kind;
      }

      // Filter by severity and status. The API reads these as repeated keys
      // (severity=CRITICAL&severity=HIGH), so the request below uses the
      // repeated-key serializer; the default bracketed form is not parsed. The
      // API's severity choices are uppercase, so the tool's lowercase enum
      // values are normalized before sending or the request is rejected (400).
      params.severity = options.severity.map((s) => s.toUpperCase());
      params.status = options.status;

      // Make API request to get checks
      const response = await this.client.apiRequest<any>(
        `scans/${encodeURIComponent(scanId)}/checks/`,
        'GET',
        params,
        null,
        false,
        serializeRepeatedParams
      );

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'text') {
        return formatScanChecksText(response);
      } else if (format === 'table') {
        return formatScanChecksTable(response);
      }

      return JSON.stringify(response);
    } catch (error) {
      console.error(`Error getting scan checks: ${error}`);
      throw new Error(`Failed to get scan checks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Get checked paths for a scan
   * @param scanId ID of the scan to get paths for
   * @param options Additional options for filtering paths
   * @param format Output format
   * @returns List of checked paths
   */
  async getScanPaths(
    scanId: string,
    options: {
      page?: number;
      page_size?: number;
      filter?: string;
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // Use API endpoint from https://docs.nightvision.net/reference/scans_paths_list
      console.error(`Getting scan paths for ${scanId} via API endpoint...`);

      // Build query parameters
      const params: Record<string, any> = {};

      if (options.page) {
        params.page = options.page;
      }

      if (options.page_size) {
        params.page_size = options.page_size;
      }

      if (options.filter) {
        params.filter = options.filter;
      }

      // Make API request to get paths
      const response = await this.client.apiRequest<any>(
        `scans/${encodeURIComponent(scanId)}/paths/`,
        'GET',
        params
      );

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'text') {
        return formatScanPathsText(response);
      } else if (format === 'table') {
        return formatScanPathsTable(response);
      }

      return JSON.stringify(response);
    } catch (error) {
      console.error(`Error getting scan paths: ${error}`);
      throw new Error(`Failed to get scan paths: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Fetch the configured check catalog from the API.
   * Cached for the lifetime of the server process.
   */
  async getConfiguredChecks(): Promise<ConfiguredChecks> {
    if (this.cachedChecks) return this.cachedChecks;
    const response = await this.client.apiRequest<ConfiguredChecks>('common/configured-checks/', 'GET');
    this.cachedChecks = response;
    return response;
  }
}
