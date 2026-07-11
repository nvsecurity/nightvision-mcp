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
  level?: string;
  message?: { text?: string };
  locations?: SarifLocation[];
  properties?: Record<string, any>;
}

interface SarifLog {
  runs?: Array<{ results?: SarifResult[] }>;
}

export interface SourceFinding {
  rule: string | null;
  level: string | null;
  message: string | null;
  file: string | null;
  line: number | null;
}

/**
 * Pull the source-linked findings out of a SARIF log: the rule, severity, and the
 * source file:line each finding maps to. This is the moat made visible: when the
 * SARIF was exported with the discovered OpenAPI spec attached, each finding
 * carries a physicalLocation pointing at the handler in source, so an agent can
 * report "SQL injection at routes/users.js:42" instead of just a severity count.
 * Findings with no source location are still returned (file/line null) so nothing
 * is hidden.
 */
export function extractSourceFindings(sarif: unknown, limit = 20): SourceFinding[] {
  const log = sarif as SarifLog;
  const runs = Array.isArray(log?.runs) ? log.runs : [];
  const findings: SourceFinding[] = [];

  for (const run of runs) {
    const results = Array.isArray(run?.results) ? run.results : [];
    for (const result of results) {
      const loc = result.locations?.[0]?.physicalLocation;
      const uri = loc?.artifactLocation?.uri;
      const startLine = loc?.region?.startLine;
      findings.push({
        rule: result.ruleId ?? null,
        level: result.level ?? null,
        message: result.message?.text ?? null,
        file: typeof uri === 'string' && uri.trim() ? uri : null,
        line: typeof startLine === 'number' ? startLine : null
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
