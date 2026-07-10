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

  // Structured output: trust ONLY the labeled id fields. A managed scan whose id
  // is still pending deliberately sets id/extracted_id to null, but the rest of
  // the JSON (project_id, stdout/stderr tails carrying CLI progress output) still
  // contains other UUIDs. Running the bare-UUID regex over that blob would return
  // a wrong id (e.g. the project UUID), so we return null here and let the caller
  // take its pending-scan path instead.
  return idFromObject(parsed);
}

