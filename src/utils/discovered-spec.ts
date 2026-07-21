import { existsSync, readdirSync } from 'fs';
import path from 'path';

export interface DiscoveredSpec {
  /** The spec to attach, or null when no spec exists at all. */
  path: string | null;
  /**
   * True when several per-language `openapi_<lang>` specs exist with no canonical
   * `openapi.yml`, so `path` is the first by name order and may be the wrong
   * language for the scanned target. Callers should warn and let the user pass an
   * explicit spec.
   */
  ambiguous: boolean;
  /** The per-language candidates considered (only populated when there is no canonical spec). */
  candidates: string[];
}

/**
 * Find the OpenAPI spec that API Discovery wrote into `<baseDir>/.nightvision`.
 *
 * This is what makes source-linked findings (Code Traceback) the DEFAULT: when a
 * caller exports SARIF without naming a spec, we attach the discovered spec so
 * every finding traces back to an endpoint and a source file:line, instead of
 * only the wait:true harness path doing so.
 *
 * Selection mirrors the harness discovery path: a canonical `openapi.yml`/
 * `openapi.yaml` wins; otherwise a single per-language `openapi_<lang>` spec is
 * used. When several per-language specs exist with no canonical spec, the first
 * by name order is returned with `ambiguous: true` and the full candidate list,
 * so the caller can warn and use it (matching the harness use-first-and-warn
 * behavior) rather than silently attaching a possibly wrong-language spec.
 * `path` is null only when no spec exists at all, so the export still succeeds
 * without source linkage.
 */
export function findDiscoveredSpec(
  baseDir: string,
  exists: (p: string) => boolean = existsSync,
  listDir: (p: string) => string[] = readdirSync
): DiscoveredSpec {
  const nvDir = path.join(baseDir, '.nightvision');
  for (const name of ['openapi.yml', 'openapi.yaml']) {
    const candidate = path.join(nvDir, name);
    if (exists(candidate)) return { path: candidate, ambiguous: false, candidates: [] };
  }
  let entries: string[];
  try {
    entries = listDir(nvDir);
  } catch {
    return { path: null, ambiguous: false, candidates: [] };
  }
  const candidates = entries
    .filter((entry) => /^openapi_.+\.(ya?ml)$/i.test(entry))
    .sort()
    .map((name) => path.join(nvDir, name));
  return {
    path: candidates[0] ?? null,
    ambiguous: candidates.length > 1,
    candidates
  };
}
