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
