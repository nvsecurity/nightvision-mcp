/**
 * Helpers for checking the installed NightVision CLI version against the minimum
 * this server relies on.
 *
 * The minimum is the CLI release where `swagger extract` gained the flag surface
 * this server uses (--file-format, --no-upload, --lang, --output); older CLIs
 * lack those options and fail at runtime. The check warns rather than blocks, and
 * is skipped when the version cannot be determined (for example a local dev build
 * that reports "Version unknown").
 */

// Oldest CLI release whose `swagger extract` flags this server depends on are all
// available (the named-to-positional argument reorganization that introduced
// --file-format / --no-upload / --lang / --output).
export const MIN_CLI_VERSION = '0.5.0';

/**
 * Extract a major.minor.patch version from `nightvision version` output. An
 * optional leading `v` is accepted (the CLI has not always been consistent about
 * the prefix) and is not part of the returned value. Returns null when no version
 * number is present (for example a dev build that reports "Version unknown").
 * @param output The raw `nightvision version` output
 * @returns The version as "major.minor.patch" (no `v` prefix), or null
 */
export function extractCliVersion(output: string): string | null {
  const m = output.match(/v?(\d+)\.(\d+)\.(\d+)/i);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

// Parse "major.minor.patch" into numeric parts, tolerating an optional leading
// v/V; missing components count as 0.
function versionParts(version: string): number[] {
  return version.replace(/^v/i, '').split('.').map((n) => Number(n) || 0);
}

/**
 * True when `version` is strictly older than `minimum`. Both are compared as
 * major.minor.patch; an optional leading `v` on either is ignored, and missing
 * components count as 0.
 * @param version Installed version, e.g. "0.5.0" or "v0.5.0"
 * @param minimum Required minimum version, e.g. "0.5.0" or "v0.5.0"
 * @returns Whether version is below minimum
 */
export function isCliVersionBelow(version: string, minimum: string): boolean {
  const v = versionParts(version);
  const m = versionParts(minimum);
  for (let i = 0; i < 3; i++) {
    if ((v[i] ?? 0) < (m[i] ?? 0)) return true;
    if ((v[i] ?? 0) > (m[i] ?? 0)) return false;
  }
  return false;
}
