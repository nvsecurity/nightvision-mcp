/**
 * Report model: turns raw NightVision API data into the fixed structure the
 * PDF/HTML report renders. Pure functions only (no I/O), so every number that
 * lands in a report a customer forwards to leadership is unit-tested.
 *
 * Everything in the input issues is target-derived and attacker-influenced
 * (payloads, evidence, reflected paths, LLM explanations of that content). The
 * model keeps it as plain strings; the renderer is responsible for escaping.
 */
import { redactSecrets, type RedactMode } from './redact.js';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' | 'UNSPECIFIED';

/** Most severe first. */
export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNSPECIFIED'];

export type SeverityCounts = Record<Severity, number>;

export type MinSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReportOptions {
  /** Findings below this severity are counted as excluded, not rendered. */
  minSeverity: MinSeverity;
  /** Show raw evidence and skip secret redaction. Off by default: PDFs get forwarded. */
  includeEvidence: boolean;
  /** Cap on affected-endpoint rows rendered per issue type. */
  maxOccurrencesPerType: number;
  /** Agent-written executive summary, rendered as plain paragraphs. */
  executiveSummary?: string | null;
  /** Agent-written fix notes keyed by issue type name (case-insensitive) or kind id. */
  remediationNotes?: Array<{ issue_type: string; note: string }>;
  title?: string | null;
  generatedAt: Date;
}

export interface TaxonomyRef {
  standard: string;
  code: string;
  name: string;
  url: string | null;
}

export interface SourceLocation {
  file: string;
  line: number | null;
}

export interface ReportOccurrence {
  issue_id: string;
  method: string;
  url: string;
  path: string;
  parameter: string | null;
  payload: string | null;
  /** null when hidden (include_evidence off) or absent. */
  evidence: string | null;
  evidence_hidden: boolean;
  curl: string;
  source: SourceLocation | null;
}

export interface ReportFinding {
  key: string;
  kind_id: number | null;
  name: string;
  severity: Severity;
  engine: string | null;
  taxonomy: TaxonomyRef[];
  explanation: string | null;
  remediation_note: string | null;
  occurrence_total: number;
  affected_paths: number;
  source_linked: number;
  occurrences: ReportOccurrence[];
}

export interface ScanSummary {
  scan_id: string;
  target_name: string;
  target_url: string | null;
  target_type: string | null;
  project_name: string | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  spec_file: string | null;
  source_linked: boolean;
  source_linked_count: number;
  /** A local OpenAPI spec was available, so a source-linking SARIF export was attempted. */
  source_link_attempted: boolean;
  engines: string[];
  paths_tested: number | null;
  excluded_url_patterns: number;
  preset: string | null;
}

export interface ComparisonEntry {
  name: string;
  severity: Severity;
  method: string;
  path: string;
  parameter: string | null;
}

export interface Comparison {
  baseline_scan_id: string;
  baseline_started_at: string | null;
  new_count: number;
  fixed_count: number;
  /** Still reported by the scanner but marked resolved/false positive since the baseline. */
  dismissed_count: number;
  /** Still reported by the scanner but now below the report's severity threshold. */
  below_threshold_count: number;
  still_open_count: number;
  new_by_severity: SeverityCounts;
  new_findings: ComparisonEntry[];
  fixed_findings: ComparisonEntry[];
}

export interface Exclusions {
  not_open: number;
  below_threshold: number;
  scan_meta: number;
}

export interface ScanReport {
  kind: 'scan';
  title: string;
  generated_at: string;
  scan: ScanSummary;
  counts: SeverityCounts;
  total_open: number;
  distinct_types: number;
  exclusions: Exclusions;
  top_findings: ReportFinding[];
  findings: ReportFinding[];
  executive_summary: string | null;
  comparison: Comparison | null;
  options: { min_severity: MinSeverity; include_evidence: boolean; max_occurrences_per_type: number };
}

export interface ProjectTargetRow {
  target_name: string;
  target_url: string | null;
  scan_id: string;
  scanned_at: string | null;
  status: string | null;
  counts: SeverityCounts;
  total_open: number;
}

export interface ProjectTopType {
  name: string;
  severity: Severity;
  targets: number;
  affected_paths: number;
}

export interface ProjectReport {
  kind: 'project';
  title: string;
  generated_at: string;
  project_name: string;
  targets: ProjectTargetRow[];
  counts: SeverityCounts;
  total_open: number;
  top_types: ProjectTopType[];
  executive_summary: string | null;
  options: { min_severity: MinSeverity; include_evidence: boolean };
}

export type Report = ScanReport | ProjectReport;

const TOP_FINDINGS = 5;
const COMPARISON_LIST_LIMIT = 20;
const PAYLOAD_LIMIT = 300;
const EVIDENCE_LIMIT = 400;
/** Longer explanations for the findings developers must act on first. */
const EXPLANATION_LIMIT: Record<Severity, number> = { CRITICAL: 1400, HIGH: 1400, MEDIUM: 900, LOW: 500, INFO: 500, UNSPECIFIED: 500 };
const NOTE_LIMIT = 2000;
const SUMMARY_LIMIT = 4000;
const CURL_BODY_LIMIT = 1500;

/** Tool names whose "findings" are scan bookkeeping, not vulnerabilities. */
const SCAN_META_TOOLS = new Set(['online-checker']);
/** Same, for the project roll-up, where only the kind name is available. */
const SCAN_META_NAME = /^scan started\b/i;

export function emptyCounts(): SeverityCounts {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, UNSPECIFIED: 0 };
}

export function normalizeSeverity(value: unknown): Severity {
  const s = String(value ?? '').trim().toUpperCase();
  if (s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM' || s === 'LOW') return s;
  if (s === 'INFO' || s === 'INFORMATIONAL') return 'INFO';
  return 'UNSPECIFIED';
}

function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

/** True when `s` is at or above the requested minimum. UNSPECIFIED is treated as INFO. */
export function meetsMinSeverity(s: Severity, min: MinSeverity): boolean {
  const minRank = severityRank(normalizeSeverity(min));
  const rank = s === 'UNSPECIFIED' ? severityRank('INFO') : severityRank(s);
  return rank <= minRank;
}

function truncate(text: string | null | undefined, limit: number): string | null {
  if (text === null || text === undefined) return null;
  const t = String(text);
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  // Prefer ending on a sentence, then a word, so shared reports never end mid-token.
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (sentence > limit * 0.6) return `${cut.slice(0, sentence + 1)} …`;
  const space = cut.lastIndexOf(' ');
  return `${space > limit * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** HTTP method as a plain token; anything else (target-influenced junk) becomes GET. */
export function safeMethod(value: unknown): string {
  const m = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{1,20}$/.test(m) ? m : 'GET';
}

/** Redact first, then truncate: a secret cut in half no longer matches the patterns. */
function clean(text: string | null | undefined, limit: number, includeEvidence: boolean, mode: RedactMode = 'data'): string | null {
  if (text === null || text === undefined) return null;
  return truncate(includeEvidence ? String(text) : redactSecrets(String(text), mode), limit);
}

/** Apply secret redaction unless the caller opted into raw evidence. */
function scrub(text: string | null, includeEvidence: boolean): string | null {
  if (text === null) return null;
  return includeEvidence ? text : redactSecrets(text, 'data');
}

function kindKey(issue: any): string {
  if (issue?.kind_id !== null && issue?.kind_id !== undefined) return `kind:${issue.kind_id}`;
  if (issue?.kind?.id !== null && issue?.kind?.id !== undefined) return `kind:${issue.kind.id}`;
  if (issue?.nuclei_template_id) return `nuclei:${issue.nuclei_template_id}`;
  return `name:${String(issue?.kind?.name ?? issue?.finding_name ?? 'Unknown')}`;
}

function kindName(issue: any): string {
  return String(issue?.kind?.name || issue?.nuclei_template?.name || issue?.finding_name || 'Unnamed finding');
}

/** Identity of one finding across scans: type + endpoint + parameter. */
export function occurrenceKey(issue: any): string {
  return [
    kindKey(issue),
    String(issue?.http_method ?? '').toUpperCase(),
    String(issue?.url_path ?? ''),
    String(issue?.parameter_name ?? ''),
  ].join('|');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a reproduction command from the recorded HAR request when present,
 * otherwise from method + URL. Sensitive headers were already redacted by the
 * issue service; this only carries content-type, never auth or cookies, so the
 * command is safe to print and the reader supplies their own session.
 */
export function buildCurl(issue: any, targetUrl: string | null, includeEvidence = true): string {
  const req = Array.isArray(issue?.extra_info?.http_requests) ? issue.extra_info.http_requests[0] : null;
  const method = safeMethod(req?.method || issue?.http_method || 'GET');
  let url = String(req?.url || '');
  if (!url) {
    const base = (targetUrl || (issue?.fqdn ? `https://${issue.fqdn}` : '')).replace(/\/+$/, '');
    url = `${base}${issue?.url_path ?? ''}`;
  }
  if (!includeEvidence) url = redactSecrets(url, 'data');
  const parts = ['curl -i', `-X ${method}`, '--', shellQuote(url)];
  const headers: Array<{ name?: string; value?: string }> = Array.isArray(req?.headers) ? req.headers : [];
  const contentType = headers.find((h) => String(h?.name).toLowerCase() === 'content-type')?.value;
  const post = req?.postData;
  let body: string | null = null;
  if (post && typeof post.text === 'string' && post.text.length > 0) {
    body = post.text;
  } else if (post && Array.isArray(post.params) && post.params.length > 0) {
    body = post.params
      .map((p: any) => `${encodeURIComponent(String(p?.name ?? ''))}=${encodeURIComponent(String(p?.value ?? ''))}`)
      .join('&');
  }
  if (body !== null) {
    if (contentType) parts.splice(parts.indexOf('--'), 0, `-H ${shellQuote(`Content-Type: ${contentType}`)}`);
    parts.splice(parts.indexOf('--'), 0, `--data-raw ${shellQuote(clean(body, CURL_BODY_LIMIT, includeEvidence) ?? '')}`);
  }
  return parts.join(' ');
}

function taxonomyOf(issue: any): TaxonomyRef[] {
  const raw = Array.isArray(issue?.kind?.taxonomy) ? issue.kind.taxonomy : [];
  // Several versions of one standard (OWASP Top 10 2017 and 2021) say the same
  // thing twice with different codes; keep only the newest version of each.
  const newest = new Map<string, string>();
  for (const t of raw) {
    const family = String(t?.standard_name || t?.standard || '').trim();
    const version = String(t?.version ?? '');
    if (!newest.has(family) || version.localeCompare(newest.get(family)!, undefined, { numeric: true }) > 0) {
      newest.set(family, version);
    }
  }
  const seen = new Set<string>();
  const out: TaxonomyRef[] = [];
  for (const t of raw) {
    const family = String(t?.standard_name || t?.standard || '').trim();
    const version = String(t?.version ?? '');
    const code = String(t?.code || '').trim();
    if (!code || version !== newest.get(family)) continue;
    const key = `${family}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ standard: `${family}${version ? ` ${version}` : ''}`.trim(), code, name: String(t?.name || ''), url: t?.reference_url || null });
  }
  return out;
}

interface FilterResult {
  kept: any[];
  exclusions: Exclusions;
}

/** Keep open, non-bookkeeping findings at or above the severity floor. */
export function filterIssues(issues: any[], minSeverity: MinSeverity): FilterResult {
  const exclusions: Exclusions = { not_open: 0, below_threshold: 0, scan_meta: 0 };
  const kept: any[] = [];
  for (const issue of issues) {
    if (SCAN_META_TOOLS.has(String(issue?.extra_info?.tool_name ?? '').toLowerCase())) {
      exclusions.scan_meta += 1;
      continue;
    }
    // resolution 0 = open; anything else (false positive, resolved, excluded) is out.
    if (issue?.resolution !== undefined && issue?.resolution !== null && Number(issue.resolution) !== 0) {
      exclusions.not_open += 1;
      continue;
    }
    if (!meetsMinSeverity(normalizeSeverity(issue?.severity), minSeverity)) {
      exclusions.below_threshold += 1;
      continue;
    }
    kept.push(issue);
  }
  return { kept, exclusions };
}

function noteLookup(notes: ReportOptions['remediationNotes']): (name: string, kindId: number | null) => string | null {
  const byKey = new Map<string, string>();
  for (const n of notes ?? []) {
    const key = String(n?.issue_type ?? '').trim().toLowerCase();
    const note = String(n?.note ?? '').trim();
    if (key && note) byKey.set(key, truncate(note, NOTE_LIMIT)!);
  }
  return (name, kindId) =>
    byKey.get(name.trim().toLowerCase()) ?? (kindId !== null ? byKey.get(String(kindId)) ?? null : null);
}

function compareFindings(a: ReportFinding, b: ReportFinding): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    b.occurrence_total - a.occurrence_total ||
    a.name.localeCompare(b.name)
  );
}

function compareOccurrences(a: ReportOccurrence, b: ReportOccurrence): number {
  // Source-linked rows first: they are the ones a developer can act on directly.
  return (Number(!!b.source) - Number(!!a.source)) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method);
}

export function groupFindings(
  issues: any[],
  opts: Pick<ReportOptions, 'includeEvidence' | 'maxOccurrencesPerType' | 'remediationNotes'>,
  targetUrl: string | null,
  sourceLinks: Map<string, SourceLocation>,
): ReportFinding[] {
  const noteFor = noteLookup(opts.remediationNotes);
  const groups = new Map<string, any[]>();
  for (const issue of issues) {
    const key = kindKey(issue);
    const list = groups.get(key);
    if (list) list.push(issue);
    else groups.set(key, [issue]);
  }

  const findings: ReportFinding[] = [];
  for (const [key, list] of groups) {
    const first = list[0];
    const name = kindName(first);
    const kindId = first?.kind_id ?? first?.kind?.id ?? null;
    // A kind can mix severities across occurrences; report the worst.
    const severity = list
      .map((i) => normalizeSeverity(i?.severity))
      .sort((a, b) => severityRank(a) - severityRank(b))[0];

    const allOccurrences: ReportOccurrence[] = list.map((issue) => {
      const rawEvidence = issue?.evidence ? String(issue.evidence) : null;
      const source = issue?.id ? sourceLinks.get(String(issue.id)) ?? null : null;
      return {
        issue_id: String(issue?.id ?? ''),
        method: safeMethod(issue?.http_method),
        url: scrub(String(issue?.extra_info?.http_requests?.[0]?.url || issue?.url_path || ''), opts.includeEvidence)!,
        path: scrub(String(issue?.url_path || '/'), opts.includeEvidence)!,
        parameter: issue?.parameter_name ? scrub(String(issue.parameter_name), opts.includeEvidence) : null,
        payload: clean(issue?.payload ? String(issue.payload) : null, PAYLOAD_LIMIT, opts.includeEvidence),
        evidence: opts.includeEvidence ? truncate(rawEvidence, EVIDENCE_LIMIT) : null,
        evidence_hidden: !opts.includeEvidence && !!rawEvidence,
        curl: buildCurl(issue, targetUrl, opts.includeEvidence),
        source,
      };
    });
    allOccurrences.sort(compareOccurrences);

    const explanationSource = list.find((i) => i?.ai_explanation)?.ai_explanation ?? null;
    findings.push({
      key,
      kind_id: kindId === null || kindId === undefined ? null : Number(kindId),
      name,
      severity,
      engine: first?.extra_info?.tool_name ? String(first.extra_info.tool_name) : null,
      taxonomy: taxonomyOf(first),
      explanation: clean(explanationSource, EXPLANATION_LIMIT[severity], opts.includeEvidence, 'prose'),
      remediation_note: noteFor(name, kindId === null || kindId === undefined ? null : Number(kindId)),
      occurrence_total: list.length,
      affected_paths: new Set(list.map((i) => `${i?.http_method}|${i?.url_path}`)).size,
      source_linked: allOccurrences.filter((o) => o.source).length,
      occurrences: allOccurrences.slice(0, opts.maxOccurrencesPerType),
    });
  }
  return findings.sort(compareFindings);
}

export function countBySeverity(issues: any[]): SeverityCounts {
  const counts = emptyCounts();
  for (const issue of issues) counts[normalizeSeverity(issue?.severity)] += 1;
  return counts;
}

function toEntry(issue: any, includeEvidence: boolean): ComparisonEntry {
  return {
    name: kindName(issue),
    severity: normalizeSeverity(issue?.severity),
    method: safeMethod(issue?.http_method),
    path: scrub(String(issue?.url_path || '/'), includeEvidence)!,
    parameter: issue?.parameter_name ? scrub(String(issue.parameter_name), includeEvidence) : null,
  };
}

function compareEntries(a: ComparisonEntry, b: ComparisonEntry): number {
  return severityRank(a.severity) - severityRank(b.severity) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
}

/** First issue per occurrence key, so counts are over distinct findings. */
function byKey(issues: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const i of issues) {
    const key = occurrenceKey(i);
    if (!map.has(key)) map.set(key, i);
  }
  return map;
}

/**
 * Diff two scans by distinct type + endpoint + parameter. `currentKept` and
 * `baselineKept` are the open findings after the same filterIssues call, so a
 * severity floor applies equally to both sides. `currentAll` is the current
 * scan's unfiltered list, used to tell apart a baseline finding that really
 * disappeared (fixed) from one the scanner still reports but that was marked
 * resolved/false positive (dismissed) or now falls below the severity
 * threshold (below_threshold). Every baseline finding lands in exactly one of
 * still_open, fixed, dismissed, below_threshold.
 */
export function compareScans(
  currentKept: any[],
  baselineKept: any[],
  baselineScan: any,
  currentAll: any[] = currentKept,
  includeEvidence = false,
): Comparison {
  const current = byKey(currentKept);
  const baseline = byKey(baselineKept);
  const all = byKey(currentAll);
  const added = [...current.entries()].filter(([k]) => !baseline.has(k)).map(([, i]) => i);
  const fixed: any[] = [];
  let dismissed = 0;
  let belowThreshold = 0;
  let stillOpen = 0;
  for (const [key, issue] of baseline) {
    if (current.has(key)) {
      stillOpen += 1;
      continue;
    }
    const later = all.get(key);
    if (!later) fixed.push(issue);
    else if (later?.resolution !== undefined && later?.resolution !== null && Number(later.resolution) !== 0) dismissed += 1;
    else belowThreshold += 1;
  }
  return {
    baseline_scan_id: String(baselineScan?.id ?? ''),
    baseline_started_at: baselineScan?.started_at ?? baselineScan?.created_at ?? null,
    new_count: added.length,
    fixed_count: fixed.length,
    dismissed_count: dismissed,
    below_threshold_count: belowThreshold,
    still_open_count: stillOpen,
    new_by_severity: countBySeverity(added),
    new_findings: added.map((i) => toEntry(i, includeEvidence)).sort(compareEntries).slice(0, COMPARISON_LIST_LIMIT),
    fixed_findings: fixed.map((i) => toEntry(i, includeEvidence)).sort(compareEntries).slice(0, COMPARISON_LIST_LIMIT),
  };
}

export function summarizeScan(
  scan: any,
  pathsTested: number | null,
  specFile: string | null,
  sourceLinked: boolean,
): ScanSummary {
  const engines: string[] = [];
  const cfg = scan?.engine_checks_configuration ?? {};
  if (cfg.use_zap) engines.push('ZAP');
  if (cfg.use_nuclei) engines.push('Nuclei');
  const excluded = Array.isArray(scan?.configuration?.excluded_url_patterns)
    ? scan.configuration.excluded_url_patterns.length
    : 0;
  const duration = typeof scan?.completed_in === 'number' ? Math.round(scan.completed_in) : null;
  return {
    scan_id: String(scan?.id ?? ''),
    target_name: String(scan?.target_name || scan?.target?.name || 'Unknown target'),
    target_url: scan?.location || scan?.target?.location || null,
    target_type: scan?.target_type || scan?.target?.type || null,
    project_name: scan?.project_name || scan?.project?.name || scan?.target?.project_name || null,
    status: scan?.status_value || null,
    started_at: scan?.started_at || scan?.created_at || null,
    ended_at: scan?.ended_at || null,
    duration_seconds: duration,
    spec_file: specFile ?? scan?.swaggerfile_name ?? null,
    source_linked: sourceLinked,
    source_linked_count: 0,
    source_link_attempted: specFile !== null,
    engines,
    paths_tested: pathsTested,
    excluded_url_patterns: excluded,
    preset: scan?.preset || null,
  };
}

function defaultTitle(name: string): string {
  return `Security Report: ${name}`;
}

export interface ScanReportInput {
  scan: any;
  issues: any[];
  pathsTested: number | null;
  specFile: string | null;
  sourceLinks: Map<string, SourceLocation>;
  baseline?: { scan: any; issues: any[] } | null;
  options: ReportOptions;
}

export function buildScanReport(input: ScanReportInput): ScanReport {
  const { options } = input;
  const summary = summarizeScan(input.scan, input.pathsTested, input.specFile, input.sourceLinks.size > 0);
  const { kept, exclusions } = filterIssues(input.issues, options.minSeverity);
  const findings = groupFindings(kept, options, summary.target_url, input.sourceLinks);
  summary.source_linked_count = kept.filter((i) => i?.id && input.sourceLinks.has(String(i.id))).length;
  const comparison = input.baseline
    ? compareScans(kept, filterIssues(input.baseline.issues, options.minSeverity).kept, input.baseline.scan, input.issues, options.includeEvidence)
    : null;
  return {
    kind: 'scan',
    title: options.title?.trim() || defaultTitle(summary.target_name),
    generated_at: options.generatedAt.toISOString(),
    scan: summary,
    counts: countBySeverity(kept),
    total_open: kept.length,
    distinct_types: findings.length,
    exclusions,
    top_findings: findings.slice(0, TOP_FINDINGS),
    findings,
    executive_summary: truncate(options.executiveSummary?.trim() || null, SUMMARY_LIMIT),
    comparison,
    options: {
      min_severity: options.minSeverity,
      include_evidence: options.includeEvidence,
      max_occurrences_per_type: options.maxOccurrencesPerType,
    },
  };
}

export interface ProjectReportInput {
  projectName: string;
  /** Latest reportable scan per target. */
  scans: any[];
  /** issues/kind/ results per scan id. */
  kindStats: Map<string, any[]>;
  options: ReportOptions;
}

export function buildProjectReport(input: ProjectReportInput): ProjectReport {
  const { options } = input;
  const totals = emptyCounts();
  const byType = new Map<string, ProjectTopType & { targetIds: Set<string> }>();
  const targets: ProjectTargetRow[] = [];

  for (const scan of input.scans) {
    const counts = emptyCounts();
    for (const stat of input.kindStats.get(String(scan?.id)) ?? []) {
      const name = String(stat?.kind_name || stat?.name || 'Unnamed finding');
      if (SCAN_META_NAME.test(name)) continue;
      const severity = normalizeSeverity(stat?.severity);
      if (!meetsMinSeverity(severity, options.minSeverity)) continue;
      const open = Number(stat?.open ?? 0);
      if (!(open > 0)) continue;
      counts[severity] += open;
      const key = stat?.kind_id !== null && stat?.kind_id !== undefined
        ? `kind:${stat.kind_id}`
        : `nuclei:${stat?.nuclei_template_id ?? name}`;
      const entry = byType.get(key) ?? { name, severity, targets: 0, affected_paths: 0, targetIds: new Set<string>() };
      entry.targetIds.add(String(scan?.target_id ?? scan?.id));
      entry.targets = entry.targetIds.size;
      entry.affected_paths += Number(stat?.vulnerable_paths_count ?? 0);
      if (severityRank(severity) < severityRank(entry.severity)) entry.severity = severity;
      byType.set(key, entry);
    }
    for (const s of SEVERITY_ORDER) totals[s] += counts[s];
    targets.push({
      target_name: String(scan?.target_name || scan?.target?.name || 'Unknown target'),
      target_url: scan?.location || scan?.target?.location || null,
      scan_id: String(scan?.id ?? ''),
      scanned_at: scan?.started_at || scan?.created_at || null,
      status: scan?.status_value || null,
      counts,
      total_open: SEVERITY_ORDER.reduce((sum, s) => sum + counts[s], 0),
    });
  }

  targets.sort((a, b) => {
    for (const s of SEVERITY_ORDER) {
      if (a.counts[s] !== b.counts[s]) return b.counts[s] - a.counts[s];
    }
    return a.target_name.localeCompare(b.target_name);
  });

  const topTypes = [...byType.values()]
    .map(({ targetIds: _ids, ...rest }) => rest)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.targets - a.targets || b.affected_paths - a.affected_paths || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    kind: 'project',
    title: options.title?.trim() || defaultTitle(input.projectName),
    generated_at: options.generatedAt.toISOString(),
    project_name: input.projectName,
    targets,
    counts: totals,
    total_open: SEVERITY_ORDER.reduce((sum, s) => sum + totals[s], 0),
    top_types: topTypes,
    executive_summary: truncate(options.executiveSummary?.trim() || null, SUMMARY_LIMIT),
    options: { min_severity: options.minSeverity, include_evidence: options.includeEvidence },
  };
}
