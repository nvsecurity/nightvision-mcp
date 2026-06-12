/**
 * Format scan-list results for table output.
 *
 * The fields are read from the actual scan shape returned by the scans list
 * endpoint: the creation timestamp is `created_at` (not `created`), and the
 * human-readable status is `status_value` (a string such as `SUCCEEDED`), while
 * `status` is only a numeric code. The table renders `status_value` when present
 * and falls back to the numeric `status` otherwise.
 */

interface Scan {
  id?: string;
  target?: { name?: string };
  project?: { name?: string };
  status?: number;
  status_value?: string;
  created_at?: string;
  [key: string]: any;
}

interface ScansResponse {
  results?: Scan[];
  [key: string]: any;
}

const NA = 'N/A';
const cell = (v: unknown): string => (v === undefined || v === null || v === '') ? NA : String(v);

export function formatScansTable(response: ScansResponse): string {
  const results = Array.isArray(response?.results) ? response.results : [];
  const headers = ['ID', 'Target', 'Status', 'Created', 'Project'];
  const rows = results.map((scan) => [
    cell(scan.id),
    cell(scan.target?.name),
    cell(scan.status_value ?? scan.status),
    cell(scan.created_at),
    cell(scan.project?.name)
  ]);
  return [
    headers.join('\t'),
    headers.map(() => '----').join('\t'),
    ...rows.map((row) => row.join('\t'))
  ].join('\n');
}
