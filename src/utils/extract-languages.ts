import type { NightVisionLanguage } from './language-detect.js';

/**
 * The --lang values the CLI accepts for each language it analyzes. The CLI
 * matches a language name or one of its aliases case-insensitively; the tool
 * narrows the input to the canonical name so that per-language output files
 * and log lines use one spelling.
 */
export const LANGUAGE_ALIASES: Record<string, NightVisionLanguage> = {
  csharp: 'csharp',
  'c#': 'csharp',
  dotnet: 'csharp',
  go: 'go',
  golang: 'go',
  java: 'java',
  js: 'js',
  javascript: 'js',
  ts: 'js',
  typescript: 'js',
  php: 'php',
  python: 'python',
  py: 'python',
  python3: 'python',
  ruby: 'ruby'
};

/** Every spelling the tool accepts, for the parameter schema. */
export const LANGUAGE_INPUTS = Object.keys(LANGUAGE_ALIASES) as [string, ...string[]];

/**
 * Normalize the langs parameter to canonical CLI language names, in input
 * order and without duplicates. An absent or empty value yields an empty
 * list, which means "do not pass --lang": the CLI then detects project roots
 * and languages on its own.
 */
export function normalizeLanguages(langs: string | string[] | undefined): NightVisionLanguage[] {
  const inputs = langs === undefined ? [] : Array.isArray(langs) ? langs : [langs];
  const out: NightVisionLanguage[] = [];
  for (const input of inputs) {
    const canonical = LANGUAGE_ALIASES[input.trim().toLowerCase()];
    if (!canonical) {
      throw new Error(`Unsupported language: ${input}. Supported languages are: csharp, go, java, js, php, python, ruby.`);
    }
    if (!out.includes(canonical)) {
      out.push(canonical);
    }
  }
  return out;
}

/**
 * The diagnostics file the CLI writes beside an extract output: the output's
 * extension is replaced by .diagnostics.json, and the file is written on every
 * run that returned analysis results, including one that found no route.
 */
export function diagnosticsPathFor(outputFile: string): string {
  return `${outputFile.replace(/\.(json|yaml|yml)$/, '')}.diagnostics.json`;
}

const LOG_PREFIX = /^\[[^\]]*\]\s+(?:DEBUG|INFO|WARN|ERROR)\s+/;

/**
 * Pull the zero-route account out of the CLI's log: the lines from "No routes
 * were discovered" up to, but not including, the final "error extracting API
 * info" line, with timestamps and levels stripped. The account names the
 * unresolved imports that look like a web framework, what each scanned root
 * contributed, and where the supported frameworks are listed, which is what a
 * caller needs when an extraction found nothing. Returns an empty string when
 * the log carries no such account.
 */
export function zeroRouteSummary(log: string | undefined): string {
  if (!log) return '';
  const lines = log.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes('No routes were discovered'));
  if (start < 0) return '';
  const kept: string[] = [];
  for (const line of lines.slice(start)) {
    if (line.includes('error extracting API info')) break;
    const text = line.replace(LOG_PREFIX, '').trimEnd();
    if (text) kept.push(text);
  }
  return kept.join('\n');
}
