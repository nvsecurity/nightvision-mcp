import * as path from 'path';

/**
 * Resolve the directory to download a traffic file into. A blank or non-absolute
 * request falls back to the home directory; if the chosen directory is not
 * writable, fall back to the home directory and then the system temp directory.
 * Surrounding quotes on the request are stripped. Writability is injected so the
 * resolution stays pure and testable.
 */
export function resolveDownloadDir(
  requested: string | undefined,
  homeDir: string,
  tmpDir: string,
  isWritable: (dir: string) => boolean
): string {
  let dir = (requested ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!dir || !path.isAbsolute(dir)) {
    dir = homeDir;
  }
  if (isWritable(dir)) {
    return dir;
  }
  if (dir !== homeDir && isWritable(homeDir)) {
    return homeDir;
  }
  return tmpDir;
}
