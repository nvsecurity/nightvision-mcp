import { existsSync, readdirSync } from 'fs';
import path from 'path';

/**
 * Find the OpenAPI spec that API Discovery wrote into `<baseDir>/.nightvision`.
 *
 * This is what makes source-linked findings (Code Traceback) the DEFAULT: when a
 * caller exports SARIF without naming a spec, we attach the discovered spec so
 * every finding traces back to an endpoint and a source file:line, instead of
 * only the wait:true harness path doing so. Returns null when no spec exists, so
 * the export still succeeds (just without source linkage).
 */
export function findDiscoveredSpec(
  baseDir: string,
  exists: (p: string) => boolean = existsSync,
  listDir: (p: string) => string[] = readdirSync
): string | null {
  const nvDir = path.join(baseDir, '.nightvision');
  for (const name of ['openapi.yml', 'openapi.yaml']) {
    const candidate = path.join(nvDir, name);
    if (exists(candidate)) return candidate;
  }
  let entries: string[];
  try {
    entries = listDir(nvDir);
  } catch {
    return null;
  }
  const langSpec = entries
    .filter((entry) => /^openapi_.+\.(ya?ml)$/i.test(entry))
    .sort()[0];
  return langSpec ? path.join(nvDir, langSpec) : null;
}
