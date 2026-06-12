/**
 * Serialize query parameters so array values become repeated keys
 * (status=1&status=2) rather than the HTTP client's default bracketed form
 * (status[]=1), which the scans API does not parse as the field. Null and
 * undefined values are skipped.
 */
export function serializeRepeatedParams(params: Record<string, any>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}
