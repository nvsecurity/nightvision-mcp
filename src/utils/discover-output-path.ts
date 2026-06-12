/**
 * Resolve the file the API-discovery CLI actually wrote.
 *
 * The CLI's YAML output forces a .yml extension, so the file it writes can
 * differ from the requested output path (for example a requested .yaml lands as
 * .yml). Given the requested path and a file-existence predicate, return the
 * path that actually exists: the requested path if present, otherwise the same
 * base name with .yml or .yaml. Returns null when no such file exists, so the
 * caller can report that no spec was produced rather than a path that is not
 * there.
 */
export function resolveActualOutputFile(
  requestedPath: string,
  exists: (p: string) => boolean
): string | null {
  if (exists(requestedPath)) {
    return requestedPath;
  }
  const base = requestedPath.replace(/\.(json|yaml|yml)$/, '');
  for (const candidate of [`${base}.yml`, `${base}.yaml`]) {
    if (candidate !== requestedPath && exists(candidate)) {
      return candidate;
    }
  }
  return null;
}
