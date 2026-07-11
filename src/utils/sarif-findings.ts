interface SarifRegion {
  startLine?: number;
  startColumn?: number;
}

interface SarifLocation {
  physicalLocation?: {
    artifactLocation?: { uri?: string };
    region?: SarifRegion;
  };
}

interface SarifResult {
  ruleId?: string;
  ruleIndex?: number;
  level?: string;
  message?: { text?: string };
  locations?: SarifLocation[];
  properties?: Record<string, any>;
}

interface SarifRule {
  id?: string;
  name?: string;
  shortDescription?: { text?: string };
}

interface SarifLog {
  runs?: Array<{
    results?: SarifResult[];
    tool?: { driver?: { rules?: SarifRule[] } };
  }>;
}

export interface SourceFinding {
  rule: string | null;
  rule_name: string | null;
  level: string | null;
  message: string | null;
  file: string | null;
  line: number | null;
}

function ruleNameLookup(rules: SarifRule[]): (result: SarifResult) => string | null {
  const byId = new Map<string, string>();
  for (const rule of rules) {
    const name = rule.name || rule.shortDescription?.text;
    if (rule.id && name) byId.set(rule.id, name);
  }
  return (result) => {
    // Prefer the catalog name (e.g. "SQL Injection - PostgreSQL") over the bare
    // ruleId (e.g. "119") so a report reads as a vulnerability, not a number.
    if (result.ruleId && byId.has(result.ruleId)) return byId.get(result.ruleId)!;
    if (typeof result.ruleIndex === 'number' && rules[result.ruleIndex]) {
      const rule = rules[result.ruleIndex];
      return rule.name || rule.shortDescription?.text || null;
    }
    return null;
  };
}

/**
 * Pull the source-linked findings out of a SARIF log: the rule, severity, and the
 * source file:line each finding maps to. This is the moat made visible: when the
 * SARIF was exported with the discovered OpenAPI spec attached, each finding
 * carries a physicalLocation pointing at the handler in source, so an agent can
 * report "SQL injection at routes/users.js:42" instead of just a severity count.
 * Findings with no source location are still returned (file/line null) so nothing
 * is hidden.
 *
 * For remediation, what a finding carries varies by class. Request-level findings
 * (injection, XSS) get a real file/line (the DAST-observable ENTRY point, i.e. the
 * endpoint handler, not always the sink) and a `message` with the endpoint,
 * vulnerable parameter, and proof-of-concept payload; fix them by opening file:line
 * and following that parameter to the sink. Response/config-level findings (missing
 * headers, weak auth, error disclosure) have file null (NightVision emits the web
 * root "/", filtered above) and are fixed in the app's security config. The SARIF
 * carries no patch (`fixes`/`codeFlows` empty), so this is a locate-and-fix aid.
 */
export function extractSourceFindings(sarif: unknown, limit = 20): SourceFinding[] {
  const log = sarif as SarifLog;
  const runs = Array.isArray(log?.runs) ? log.runs : [];
  const findings: SourceFinding[] = [];

  for (const run of runs) {
    const results = Array.isArray(run?.results) ? run.results : [];
    const nameOf = ruleNameLookup(Array.isArray(run?.tool?.driver?.rules) ? run.tool!.driver!.rules! : []);
    for (const result of results) {
      const loc = result.locations?.[0]?.physicalLocation;
      const uri = loc?.artifactLocation?.uri;
      const startLine = loc?.region?.startLine;
      // NightVision emits uri "/" (the target web root) for findings it cannot map
      // to a specific source handler: site-wide/response-level issues like missing
      // security headers, weak auth method, or error disclosure. That is NOT a
      // source location, so do not count it as source-linked or the count lies.
      const hasSource = typeof uri === 'string' && uri.trim().length > 0 && uri !== '/';
      findings.push({
        rule: result.ruleId ?? null,
        rule_name: nameOf(result),
        level: result.level ?? null,
        message: result.message?.text ?? null,
        file: hasSource ? uri : null,
        line: hasSource && typeof startLine === 'number' ? startLine : null
      });
    }
  }

  // Surface source-linked findings first, so the moat is what a reader sees.
  findings.sort((a, b) => Number(b.file !== null) - Number(a.file !== null));
  return findings.slice(0, Math.max(0, limit));
}

export function countSourceLinked(findings: SourceFinding[]): number {
  return findings.filter((f) => f.file !== null).length;
}
