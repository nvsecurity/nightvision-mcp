/**
 * Map the coarse list-scans status filter names to the API's numeric scan-status
 * codes. The codes are 1 SUCCEEDED, 2 RUNNING, 3 ABORTED, 4 FAILED, 5 TIMED_OUT,
 * 6 SCHEDULED. The scans API filters on these numeric codes through a
 * multi-valued field, so the coarse names are translated before the request.
 *
 * "finished" means any terminal state and "failed" the unsuccessful terminal
 * states. An unrecognized name (including "all") yields no codes, which the
 * caller treats as "send no status filter".
 */
export const SCAN_STATUS_FILTER_CODES: Record<string, number[]> = {
  running: [2],
  finished: [1, 3, 4, 5],
  failed: [3, 4, 5]
};

export function scanStatusFilterCodes(status: string): number[] {
  return SCAN_STATUS_FILTER_CODES[status] ?? [];
}

export type ScanTerminalState = 'running' | 'succeeded' | 'failed' | 'unknown';

const SUCCEEDED_CODES = new Set([1]);
const RUNNING_CODES = new Set([2, 6]);
const FAILED_CODES = new Set([3, 4, 5]);

const SUCCEEDED_NAMES = new Set([
  'SUCCEEDED',
  'SUCCESS',
  'FINISHED',
  'COMPLETED',
  'COMPLETE',
  'DONE'
]);

const RUNNING_NAMES = new Set([
  'RUNNING',
  'SCHEDULED',
  'PENDING',
  'QUEUED',
  'STARTED',
  'IN_PROGRESS',
  'IN PROGRESS'
]);

const FAILED_NAMES = new Set([
  'ABORTED',
  'FAILED',
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'TIMED OUT',
  'TIMEOUT',
  'CANCELED',
  'CANCELLED'
]);

function statusValue(response: any): unknown {
  if (!response || typeof response !== 'object') return undefined;

  return (
    response.status_value ??
    response.status ??
    response.state ??
    response.scan_status ??
    response.scan?.status_value ??
    response.scan?.status ??
    response.result?.status_value ??
    response.result?.status
  );
}

function normalizeName(value: string): string {
  return value.trim().replace(/[\s-]+/g, '_').toUpperCase();
}

export function classifyScanStatus(response: any): ScanTerminalState {
  const value = statusValue(response);

  if (typeof value === 'number') {
    if (SUCCEEDED_CODES.has(value)) return 'succeeded';
    if (RUNNING_CODES.has(value)) return 'running';
    if (FAILED_CODES.has(value)) return 'failed';
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isInteger(numeric)) {
      if (SUCCEEDED_CODES.has(numeric)) return 'succeeded';
      if (RUNNING_CODES.has(numeric)) return 'running';
      if (FAILED_CODES.has(numeric)) return 'failed';
    }

    const normalized = normalizeName(value);
    if (SUCCEEDED_NAMES.has(normalized)) return 'succeeded';
    if (RUNNING_NAMES.has(normalized)) return 'running';
    if (FAILED_NAMES.has(normalized)) return 'failed';
  }

  return 'unknown';
}

function positiveNumber(value: unknown): boolean {
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0;
  }
  return false;
}

// The statistics objects are severity->count maps (e.g. `{ High: 2, Low: 0 }`).
// Only these severity buckets denote findings; a non-count numeric that a
// statistics object may also carry (a `total_paths`/`scanned` path total, a
// duration, an id) must NOT read as a finding, or a genuinely zero-finding scan
// would be reported as having findings and suppress the coverage floor's
// zero-coverage warning.
const SEVERITY_KEYS = new Set([
  'critical',
  'high',
  'medium',
  'low',
  'info',
  'informational',
  'unknown',
  'unspecified'
]);

function statsHaveFindings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    // Count a positive number only when it sits under a known severity key.
    // Any other key is still descended into (a nested `by_severity` wrapper is
    // supported) but its own scalar value never counts.
    if (SEVERITY_KEYS.has(key.trim().toLowerCase()) && positiveNumber(entry)) {
      return true;
    }
    return statsHaveFindings(entry);
  });
}

export function scanHasFindings(response: any): boolean {
  if (!response || typeof response !== 'object') return false;

  const numericFields = [
    response.issues_count,
    response.issue_count,
    response.findings_count,
    response.finding_count,
    response.vulnerabilities_count,
    response.vulnerability_count,
    response.scan?.issues_count,
    response.scan?.findings_count,
    response.result?.issues_count,
    response.result?.findings_count
  ];
  if (numericFields.some(positiveNumber)) return true;

  return [
    response.issues_statistics,
    response.unique_issues_statistics,
    response.vulnerable_paths_statistics,
    response.findings_statistics,
    response.scan?.issues_statistics,
    response.result?.issues_statistics
  ].some(statsHaveFindings);
}
