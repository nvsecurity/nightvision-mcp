/**
 * Detect optional NightVision CLI flags from `--help` output.
 *
 * A flag check reads what the installed binary actually accepts, so it also
 * works for dev builds that report no version number (where a version check
 * would have to be skipped).
 */

/** The `nightvision scan` flag that skips custom Nuclei templates (NV-6604). */
export const DISABLE_NUCLEI_TEMPLATES_FLAG = '--disable-nuclei-templates';

/**
 * True when the help text lists `flag` as one of the command's own flags. Only
 * a flag at the start of an indented flag line counts, so a mention inside
 * another flag's description does not.
 * @param helpText The raw `<command> --help` output
 * @param flag The long flag, e.g. "--disable-nuclei-templates"
 */
export function helpListsFlag(helpText: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s+(?:-\\w,\\s+)?${escaped}(?![\\w-])`, 'm').test(helpText);
}
