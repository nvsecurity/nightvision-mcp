const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function stringId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function idFromObject(value: any): string | null {
  if (!value || typeof value !== 'object') return null;

  return (
    stringId(value.id) ||
    stringId(value.scan_id) ||
    stringId(value.scanId) ||
    stringId(value.extracted_id) ||
    stringId(value.result?.id) ||
    stringId(value.result?.scan_id) ||
    stringId(value.result?.scanId) ||
    stringId(value.scan?.id) ||
    stringId(value.scan?.scan_id) ||
    stringId(value.scan?.scanId) ||
    null
  );
}

// The scan id, LABELED. The CLI always prints "Scan ID: <uuid>" once the scan is
// accepted, even when the managed-scan wrapper still reports id/extracted_id as
// pending. The label makes this unambiguous, unlike a bare-UUID scan that could
// grab the project/target id from the same log, so it is safe to trust.
const LABELED_SCAN_ID_RE = /Scan ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

function idFromCliStreams(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value.raw && typeof value.raw === 'object') ? value.raw : value;
  const streams = [raw.stdout_tail, raw.stderr_tail, value.stdout_tail, value.stderr_tail];

  // Prefer the labeled id anywhere in the CLI output.
  for (const stream of streams) {
    if (typeof stream !== 'string') continue;
    const labeled = stream.match(LABELED_SCAN_ID_RE);
    if (labeled) return labeled[1];
  }

  // The CLI also prints the bare scan id to stdout on its own; trust it only when
  // the tail's last non-empty line IS exactly a uuid (stdout carries the scan id,
  // not the project/target ids that live in the stderr log).
  const stdout = typeof raw.stdout_tail === 'string' ? raw.stdout_tail : '';
  const lastLine = stdout.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean).pop() ?? '';
  const bare = lastLine.match(UUID_RE);
  if (bare && bare[0] === lastLine) return bare[0];

  return null;
}

export function extractScanId(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Non-JSON CLI text: fall back to a conservative bare-UUID scan.
    return trimmed.match(UUID_RE)?.[0] ?? null;
  }

  // Structured output: trust the labeled id fields first. A managed local scan
  // reports id/extracted_id as pending, but the CLI still printed the id to its
  // stdout/stderr tails. Recover it from there via the LABELED "Scan ID:" pattern
  // (and the bare-uuid stdout line) rather than a blind blob scan that could grab
  // the project/target UUID. This keeps a running scan from being reported as
  // SCAN_ID_NOT_FOUND just because the wrapper hadn't promoted the id yet.
  return idFromObject(parsed) || idFromCliStreams(parsed);
}

