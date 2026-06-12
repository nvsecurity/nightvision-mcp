/**
 * Format scan-check (vulnerability) results for text and table output.
 *
 * The fields are read from the actual scan-check shape returned by the API
 * (`name`, `kind`, `severity`, `status`, `created_at`); `status` is a numeric
 * code where 0 (open) is a real value, so it is rendered directly rather than
 * being treated as falsy. The pagination hint names the parameters the tool
 * actually accepts (`page` / `page_size`).
 */

interface ScanCheck {
  id?: string;
  name?: string;
  kind?: string;
  severity?: string;
  status?: number;
  created_at?: string;
  [key: string]: any;
}

interface ScanChecksResponse {
  count?: number;
  results?: ScanCheck[];
  [key: string]: any;
}

const NA = 'N/A';
const cell = (v: unknown): string => (v === undefined || v === null || v === '') ? NA : String(v);
// status 0 (open) is a real value, so only undefined/null become N/A.
const statusCell = (v: unknown): string => (v === undefined || v === null) ? NA : String(v);
// Prefer the human-readable name, falling back to the kind, for the title.
const title = (c: ScanCheck): string => cell(c.name || c.kind);

function pageHint(checks: ScanChecksResponse, shown: number): string {
  return (checks.count ?? 0) > shown
    ? `Note: Showing ${shown} of ${checks.count} total vulnerabilities. Use 'page' and 'page_size' to see more.\n`
    : '';
}

export function formatScanChecksText(checks: ScanChecksResponse): string {
  if (!checks || !Array.isArray(checks.results)) {
    return 'No vulnerabilities found or invalid response format.';
  }
  const results = checks.results;
  let output = `Scan Vulnerabilities (${results.length}):\n\n`;
  results.forEach((c, i) => {
    output += `Vulnerability ${i + 1}: ${title(c)}\n`;
    output += `ID: ${cell(c.id)}\n`;
    output += `Kind: ${cell(c.kind)}\n`;
    output += `Severity: ${cell(c.severity)}\n`;
    output += `Status: ${statusCell(c.status)}\n`;
    output += `Created: ${cell(c.created_at)}\n\n`;
  });
  output += pageHint(checks, results.length);
  return output;
}

export function formatScanChecksTable(checks: ScanChecksResponse): string {
  if (!checks || !Array.isArray(checks.results)) {
    return 'No vulnerabilities found or invalid response format.';
  }
  const results = checks.results;
  const headers = ['#', 'Name', 'Kind', 'Severity', 'Status', 'Created'];
  const rows = results.map((c, i) => [
    String(i + 1),
    title(c),
    cell(c.kind),
    cell(c.severity),
    statusCell(c.status),
    cell(c.created_at)
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const renderRow = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');
  const table = [renderRow(headers), separator, ...rows.map(renderRow)].join('\n');
  const hint = pageHint(checks, results.length);
  return hint ? `${table}\n${hint}` : table;
}
