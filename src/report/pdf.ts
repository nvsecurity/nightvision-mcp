/**
 * Print a report HTML file to PDF with the Chromium-family browser the user
 * already has. No bundled browser and no new dependency: if none is found the
 * caller keeps the HTML and tells the user to print it.
 *
 * Rendering notes (from NightVision's collateral pipeline):
 *  - The NEW headless engine (--headless=new) embeds real fonts; the old one
 *    produces Type 3 glyphs that look fuzzy in Acrobat.
 *  - A throwaway --user-data-dir keeps this away from the user's running browser
 *    profile. headless=new can linger after writing the file, so a watchdog
 *    stops ONLY the process this function spawned, never "all Chrome".
 *  - On macOS Chrome tags its output with xattrs that make Finder insist on
 *    opening the PDF in Chrome; those are cleared.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, open, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Exists = (p: string) => boolean;

function onPath(name: string, env: NodeJS.ProcessEnv, exists: Exists, platform: NodeJS.Platform): string | null {
  const sep = platform === 'win32' ? ';' : ':';
  const exts = platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of String(env.PATH ?? '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Locate Chrome, Chromium, Edge, or Brave. NIGHTVISION_CHROME_PATH (then
 * CHROME_PATH) wins when set, so CI or unusual installs can point at a binary.
 */
export function findChromeBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: Exists = existsSync,
): string | null {
  for (const override of [env.NIGHTVISION_CHROME_PATH, env.CHROME_PATH]) {
    if (override && exists(override)) return override;
  }

  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Chromium.app/Contents/MacOS/Chromium',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
    const roots = ['/Applications', path.join(env.HOME || os.homedir(), 'Applications')];
    for (const root of roots) {
      for (const app of apps) {
        const candidate = path.join(root, app);
        if (exists(candidate)) return candidate;
      }
    }
  }

  if (platform === 'win32') {
    const bases = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean) as string[];
    const rels = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Chromium\\Application\\chrome.exe',
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ];
    for (const base of bases) {
      for (const rel of rels) {
        const candidate = path.win32.join(base, rel);
        if (exists(candidate)) return candidate;
      }
    }
  }

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'chrome', 'msedge']) {
    const found = onPath(name, env, exists, platform);
    if (found) return found;
  }
  return null;
}

export function chromePrintArgs(htmlPath: string, pdfPath: string, profileDir: string, runningAsRoot: boolean): string[] {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-pdf-header-footer',
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${pdfPath}`,
  ];
  // Chromium refuses to start as root without this (common in containers/CI).
  if (runningAsRoot) args.push('--no-sandbox');
  args.push(pathToFileURL(htmlPath).href);
  return args;
}

async function fileSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size;
  } catch {
    return 0;
  }
}

/**
 * A complete PDF starts with "%PDF-" and ends with "%%EOF" (allowing trailing
 * whitespace). Checking both catches a file cut off mid-write.
 */
export async function isCompletePdf(p: string): Promise<boolean> {
  const handle = await open(p, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 16) return false;
    const head = Buffer.alloc(5);
    await handle.read(head, 0, 5, 0);
    const tailLength = Math.min(1024, size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    return head.toString('latin1') === '%PDF-' && tail.toString('latin1').includes('%%EOF');
  } finally {
    await handle.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve true once the process exits, or false after `ms`. */
function waitForExit(child: ChildProcess, state: { exited: boolean }, ms: number): Promise<boolean> {
  if (state.exited) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(state.exited), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Stop the browser this module spawned, and only it. Windows needs taskkill /T
 * to take Chrome's child processes with it; elsewhere SIGTERM, then SIGKILL.
 */
async function stopBrowser(child: ChildProcess, state: { exited: boolean }): Promise<void> {
  if (state.exited || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await waitForExit(child, state, 5_000);
    return;
  }
  child.kill('SIGTERM');
  if (!(await waitForExit(child, state, 5_000))) {
    child.kill('SIGKILL');
    await waitForExit(child, state, 2_000);
  }
}

/**
 * Print `htmlPath` to `pdfPath`. Chrome writes into a private temp directory;
 * the result is validated and only then copied over `pdfPath`, so a failed
 * print never destroys an existing report at that path.
 */
export async function printHtmlToPdf(
  htmlPath: string,
  pdfPath: string,
  chromePath: string,
  timeoutMs = 60_000,
): Promise<void> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'nightvision-report-chrome-'));
  const profileDir = path.join(workDir, 'profile');
  const tempPdf = path.join(workDir, 'report.pdf');
  const state = { exited: false };
  let spawnError: Error | null = null;
  let child: ChildProcess | null = null;
  try {
    const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    child = spawn(chromePath, chromePrintArgs(htmlPath, tempPdf, profileDir, runningAsRoot), {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('exit', () => { state.exited = true; });
    child.on('error', (err) => { spawnError = err; state.exited = true; });

    // Chrome exiting is the normal completion signal. headless=new sometimes
    // lingers after writing, so a PDF that is complete and has stopped growing
    // also counts; a partial file never does.
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    let done = false;
    while (Date.now() < deadline) {
      if (state.exited) {
        done = true;
        break;
      }
      const size = await fileSize(tempPdf);
      if (size > 0 && size === last && (await isCompletePdf(tempPdf))) {
        // Give Chrome a moment to exit on its own before stopping it.
        await waitForExit(child, state, 2_000);
        done = true;
        break;
      }
      last = size;
      await sleep(500);
    }
    if (spawnError) throw new Error(`Could not start ${chromePath}: ${(spawnError as Error).message}`);
    if (!done) throw new Error(`The browser did not finish printing within ${Math.round(timeoutMs / 1000)} seconds.`);
  } finally {
    if (child) await stopBrowser(child, state);
  }

  try {
    if ((await fileSize(tempPdf)) === 0) throw new Error('The browser exited without writing a PDF.');
    if (!(await isCompletePdf(tempPdf))) throw new Error('The browser wrote an incomplete or invalid PDF.');
    await copyFile(tempPdf, pdfPath);
    if (process.platform === 'darwin') {
      spawnSync('xattr', ['-c', pdfPath], { stdio: 'ignore' });
    }
  } finally {
    await rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
  }
}
