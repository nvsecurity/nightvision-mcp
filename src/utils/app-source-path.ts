import os from 'os';
import path from 'path';

/**
 * API Discovery and source-linking read from the scan's `project_path`. If that
 * path is the user's home directory or a filesystem root, it is almost certainly
 * the shell's default working directory, not the app's source tree. Discovery
 * would then find no handlers, the scan would fall back to a stale or empty spec
 * (or a bare WEB target), and the whole point (findings that trace to a source
 * file:line) is silently lost. The real-world failure mode is a developer running
 * the agent from their home directory: preflight "inspects the home directory,
 * not the repo," and the scan reports near-nothing while looking like it ran.
 *
 * Refuse those paths so the agent is forced to pass the app's actual source
 * directory. A normal project directory (even one with no detected language, which
 * is a legitimate WEB-target scan) is allowed through.
 */
export function isNonAppSourcePath(
  projectPath: string,
  homeDir: string = os.homedir()
): boolean {
  const resolved = path.resolve(projectPath);
  return resolved === path.resolve(homeDir) || resolved === path.parse(resolved).root;
}
