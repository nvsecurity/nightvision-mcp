/**
 * Best-effort secret masking for text that lands in a shareable report.
 *
 * Scan evidence and the explanations derived from it can quote whatever the
 * target returned: session tokens, API keys, private keys. A PDF gets forwarded
 * well beyond the security team, so the report masks recognizable secrets
 * unless the caller explicitly asks for raw evidence. This is a safety net, not
 * a guarantee; the report says so.
 *
 * Callers must redact BEFORE truncating: a secret cut in half no longer
 * matches these patterns.
 */

const MASK = '[REDACTED]';

/** Key names whose values are secrets, in key=value, key: value, and JSON forms. */
const SECRET_KEYS = [
  'password', 'passwd', 'pwd', 'pass', 'passphrase',
  'secret', 'client[_-]?secret', 'private[_-]?key',
  'api[_-]?key', 'apikey', 'x-api-key',
  'token', 'access[_-]?token', 'refresh[_-]?token', 'id[_-]?token', 'auth[_-]?token', 'csrf[_-]?token', 'jwt',
  'session', 'session[_-]?id', 'sessionid', 'sid', 'phpsessid', 'jsessionid', 'connect\\.sid',
  'authorization', 'cookie', 'credentials?',
].join('|');

const PATTERNS: Array<[RegExp, string]> = [
  // PEM private keys, whole block or a block cut off before its END line.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
  // JSON Web Tokens (two or three segments, so a trailing cut still matches).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g, MASK],
  // AWS access key ids.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK],
  // GitHub, Slack, Stripe, Google API keys.
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, MASK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, MASK],
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, MASK],
  // Authorization / Proxy-Authorization header values, whole line (scheme and credential).
  [/((?:Proxy-)?Authorization\s*:\s*)[^\r\n]+/gi, `$1${MASK}`],
  // Authorization schemes. Case-sensitive and the value must contain a digit,
  // so prose like "Basic authentication over HTTP" is left alone.
  [/\b(Bearer|Basic|Token)\s+(?=[A-Za-z._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{12,}/g, `$1 ${MASK}`],
  // "key": "quoted value" (value may contain spaces).
  [new RegExp(`((?<![A-Za-z0-9_])(?:${SECRET_KEYS})["']?\\s*[:=]\\s*)(["'])[^"'\\n]{1,500}?\\2`, 'gi'), `$1$2${MASK}$2`],
  // key=value / key: value, unquoted.
  [new RegExp(`((?<![A-Za-z0-9_])(?:${SECRET_KEYS})\\s*[:=]\\s*)(?!["'\\[])([^\\s"'&,;}<>)]{3,})`, 'gim'), `$1${MASK}`],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
