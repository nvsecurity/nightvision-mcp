interface ScanCheck {
  id?: string;
  name?: string;
  kind?: string;
  severity?: string;
  status?: number;
  url?: string;
  path?: string;
  method?: string;
  parameter?: string;
  evidence?: string;
  ai_explanation?: string;
  [key: string]: any;
}

interface ScanChecksResponse {
  count?: number;
  results?: ScanCheck[];
  [key: string]: any;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  informational: 4,
  unknown: 5,
  unspecified: 6
};

function severityKey(value: unknown): string {
  return String(value || 'unknown').trim().toLowerCase();
}

function title(check: ScanCheck): string | null {
  return check.name || check.kind || null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function endpoint(check: ScanCheck) {
  const method = firstString(check.method, check.http_method, check.request_method);
  const path = firstString(check.path, check.route, check.endpoint_path);
  const url = firstString(check.url, check.uri, check.location);

  if (!method && !path && !url) {
    return null;
  }

  return { method, path, url };
}

export function summarizeScanChecks(response: ScanChecksResponse, limit = 20) {
  const results = Array.isArray(response?.results) ? response.results : [];
  const sorted = [...results].sort((a, b) => {
    const aRank = SEVERITY_RANK[severityKey(a.severity)] ?? 99;
    const bRank = SEVERITY_RANK[severityKey(b.severity)] ?? 99;
    return aRank - bRank;
  });

  // This tallies only the checks on this page. Unlike total_count/truncated
  // (which reflect the SERVER total via response.count), the CLI hands us one
  // page and no per-severity aggregate for the full set, so we cannot produce a
  // true severity total here. Named page_severity_counts so it is not misread as
  // one when total_count says there are more findings than this page holds.
  const page_severity_counts: Record<string, number> = {};
  for (const check of results) {
    const key = severityKey(check.severity);
    page_severity_counts[key] = (page_severity_counts[key] || 0) + 1;
  }

  const findings = sorted.slice(0, Math.max(0, limit)).map((check) => ({
    id: check.id || null,
    title: title(check),
    kind: check.kind || null,
    severity: check.severity || null,
    status: check.status ?? null,
    endpoint: endpoint(check),
    parameter: firstString(check.parameter, check.param, check.attack_parameter),
    evidence: firstString(check.evidence, check.proof, check.response_evidence),
    ai_explanation: firstString(check.ai_explanation, check.explanation)
  }));

  const total_count = response?.count ?? results.length;
  return {
    total_count,
    returned_count: results.length,
    summarized_count: findings.length,
    page_severity_counts,
    findings,
    // truncated reflects the SERVER total, not just this page: it is true when
    // the summary omits any finding, whether dropped by the display limit or by
    // server-side pagination (results is one page; total_count is the API total).
    truncated: findings.length < total_count
  };
}
