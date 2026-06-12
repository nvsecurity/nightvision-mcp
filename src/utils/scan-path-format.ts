/**
 * Format checked-path results for text and table output.
 *
 * Fields are read from the actual checked-path shape returned by the
 * scans/<id>/paths/ endpoint: `path` (the URL), `http_method`, `created_at`,
 * and `extra_info.response_codes` (an array of HTTP status codes). There is no
 * "completed" concept on a checked path, so no such column is shown.
 */

interface CheckedPath {
  id?: string;
  path?: string;
  http_method?: string;
  created_at?: string;
  extra_info?: { response_codes?: number[]; [key: string]: any };
  [key: string]: any;
}

interface ScanPathsResponse {
  count?: number;
  results?: CheckedPath[];
  [key: string]: any;
}

const NA = 'N/A';
const cell = (v: unknown): string => (v === undefined || v === null || v === '') ? NA : String(v);

// The status column is the set of observed HTTP response codes for the path.
const statusCodes = (p: CheckedPath): string => {
  const codes = p.extra_info?.response_codes;
  return Array.isArray(codes) && codes.length > 0 ? codes.join(', ') : NA;
};

function pageHint(paths: ScanPathsResponse, shown: number): string {
  return (paths.count ?? 0) > shown
    ? `Note: Showing ${shown} of ${paths.count} total paths. Use 'page' and 'page_size' parameters for pagination.\n`
    : '';
}

export function formatScanPathsText(paths: ScanPathsResponse): string {
  if (!paths || !Array.isArray(paths.results)) {
    return 'No paths found or invalid response format.';
  }
  const results = paths.results;
  let output = `Scan Checked Paths (${results.length}):\n\n`;
  results.forEach((p, i) => {
    output += `Path ${i + 1}: ${cell(p.path)}\n`;
    output += `Method: ${cell(p.http_method)}\n`;
    output += `Status Code: ${statusCodes(p)}\n`;
    output += `Date: ${cell(p.created_at)}\n\n`;
  });
  output += pageHint(paths, results.length);
  return output;
}

export function formatScanPathsTable(paths: ScanPathsResponse): string {
  if (!paths || !Array.isArray(paths.results)) {
    return 'No paths found or invalid response format.';
  }
  const results = paths.results;
  const headers = ['#', 'Method', 'URL', 'Status', 'Date'];
  const rows = results.map((p, i) => [
    String(i + 1),
    cell(p.http_method),
    cell(p.path),
    statusCodes(p),
    cell(p.created_at)
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const renderRow = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');
  const table = [renderRow(headers), separator, ...rows.map(renderRow)].join('\n');
  const hint = pageHint(paths, results.length);
  return hint ? `${table}\n${hint}` : table;
}
