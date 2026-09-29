/**
 * Best-effort secret masking for text that lands in a shareable report.
 *
 * Scan evidence and the explanations derived from it can quote whatever the
 * target returned: session tokens, API keys, private keys, and the scanner's
 * own login credentials in request bodies. A PDF gets forwarded well beyond the
 * security team, so the report masks recognizable secrets unless the caller
 * explicitly asks for raw evidence. This is a safety net, not a guarantee; the
 * report says so.
 *
 * Two modes, because the inputs differ:
 *  - 'data' (payloads, URLs, paths, request bodies): machine text, so any value
 *    of a secret-named key is masked, whatever it looks like.
 *  - 'prose' (scanner explanations): English about passwords, tokens and
 *    sessions, so a value is masked only when it looks like a secret (6+
 *    characters with a digit or symbol). "password: field allows autocomplete"
 *    stays readable.
 *
 * Callers must redact BEFORE truncating: a secret cut in half no longer
 * matches these patterns. Input is capped at MAX_INPUT first, and every
 * pattern is linear on adversarial input (the input is target-controlled).
 */

const MASK = '[REDACTED]';

/** Longer than any field the report renders; bounds the regex work per field. */
export const MAX_INPUT = 64 * 1024;

export type RedactMode = 'data' | 'prose';

/** Key names whose values are secrets. Matched with optional prefixes/suffixes (j_password, user[password], secretKey). */
const SECRET_KEYS = [
  'password', 'passwd', 'pwd', 'pass', 'passphrase',
  'secret', 'private[_-]?key', '(?:access|account|secret|api|auth)[_-]?key', 'apikey', 'key',
  'token', '(?:access|refresh|id|auth|csrf|xsrf|session|bearer)[_-]?token', 'client[_-]?secret', 'jwt', 'sig', 'signature', 'code',
  'session', 'sid', 'phpsessid', 'jsessionid', 'credentials?',
].join('|');

/**
 * A key: optional prefix that must END in a separator (so "bypass" is not
 * "pass"), the secret name, then an optional word/bracket suffix
 * (password_confirmation, secretKey, password], password%5D). Bounded
 * repetition keeps matching linear.
 */
const KEY = `(?<![A-Za-z0-9])(?:[A-Za-z0-9_.\\-\\[\\]]{0,40}(?:[_.\\-\\[]|%5[Bb]))?(?:${SECRET_KEYS})(?:[A-Za-z0-9_.\\-\\]]|%5[Dd]){0,40}`;
const SEP = `["']?\\s{0,5}[:=]\\s{0,5}`;

/** A double- or single-quoted value, honoring backslash escapes, to the closing quote or end of line. */
const QUOTED_DATA = `(["'])(?:\\\\.|(?!\\2)[^\\\\\\n])*(?:\\2|(?=\\n)|$)`;
/** Unquoted value in data: anything up to a delimiter. */
const UNQUOTED_DATA = `(?!["'])[^\\s&,;}<>)"'\\]]+`;
/**
 * In prose a value must look like a secret: 6+ chars including a digit or
 * symbol, or 16+ chars mixing upper and lower case (letters-only tokens such
 * as AWS session tokens). Ordinary English words match neither.
 */
const V = `[^\\s&,;}<>)"']`;
const SECRETISH = `(?:(?=${V}{0,200}[0-9!@#$%^*+/=_\\-])${V}{6,}|(?=${V}{0,200}[A-Z])(?=${V}{0,200}[a-z])${V}{16,})`;

const COMMON: Array<[RegExp, string]> = [
  // PEM private keys: header plus base64 body (END line optional, so a cut-off
  // key is still masked). A header quoted alone in prose is left as is.
  [/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----(?:\s{0,4}[A-Za-z0-9+/=]{16,}){1,400}(?:\s{0,4}-----END [A-Z ]{0,40}PRIVATE KEY-----)?/g, MASK],
  // JSON Web Tokens (two or three segments). The lookbehind excludes "-", so a
  // long run of "-eyJ..." cannot restart the match at every dash.
  [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g, MASK],
  // Credentials embedded in a URL: scheme://user:secret@host
  [/\b([a-z][a-z0-9+.-]{0,20}:\/\/[^/\s:@]{1,100}:)[^@\s/]{1,200}@/gi, `$1${MASK}@`],
  // Provider keys.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}/g, MASK],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, MASK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g, MASK],
  [/\bsk-(?:proj|ant)-[A-Za-z0-9_-]{20,}/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, MASK],
  [/\bya29\.[A-Za-z0-9_-]{20,}/g, MASK],
  // Authorization header values, only when they look like credentials, so an
  // explanation headed "Authorization: missing checks ..." survives.
  [/((?:Proxy-)?[Aa]uthorization\s{0,5}:\s{0,5})(?:(?:Bearer|Basic|Digest|Negotiate|NTLM|Token|ApiKey|AWS4-HMAC-SHA256)\s+[^\r\n]+|(?=[^\s]{0,200}[0-9])[^\s]{16,})/g, `$1${MASK}`],
  // Scheme + credential outside a header. Case-sensitive, and the value must
  // contain a digit or symbol, so "Basic authentication" stays readable.
  [/\b(Bearer|Basic|Token)\s+(?=[A-Za-z]{0,200}[0-9._~+/=-])[A-Za-z0-9._~+/=-]{12,}/g, `$1 ${MASK}`],
  // Form fields carrying passwords or CSRF/session tokens.
  [/(name=["'][^"'>]{0,60}(?:csrf|token|session|pass|pwd|secret)[^"'>]{0,60}["'][^>]{0,100}?value=["'])[^"']{1,4000}/gi, `$1${MASK}`],
];

/** Cookie attributes whose values are not secrets. */
const COOKIE_ATTRIBUTES = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'priority', 'partitioned']);

/** Mask every cookie value on Cookie/Set-Cookie lines, keeping names and attributes (flags matter to the finding). */
function maskCookieHeaders(text: string): string {
  return text.replace(/((?:Set-)?Cookie\s{0,5}:\s{0,5})([^\r\n]{1,8000})/gi, (_m, head: string, rest: string) => {
    if (!rest.includes('=')) return `${head}${rest}`;
    const masked = rest.replace(/(^|;\s{0,5})([^=;\s]{1,200})=([^;\r\n]{0,4000})/g, (_p, lead: string, name: string, value: string) =>
      COOKIE_ATTRIBUTES.has(name.toLowerCase()) || value.length === 0 ? `${lead}${name}=${value}` : `${lead}${name}=${MASK}`);
    return `${head}${masked}`;
  });
}

/** Never re-mask a value an earlier rule already replaced. */
const NOT_MASKED = `(?!\\[REDACTED\\])`;

const KEY_VALUE: Record<RedactMode, Array<[RegExp, string]>> = {
  data: [
    [new RegExp(`(${KEY}${SEP})${NOT_MASKED}${QUOTED_DATA}`, 'gi'), `$1$2${MASK}$2`],
    [new RegExp(`(${KEY}${SEP})${NOT_MASKED}${UNQUOTED_DATA}`, 'gi'), `$1${MASK}`],
  ],
  prose: [
    // A quoted JSON key ("password": "...") is machine text quoted inside an
    // explanation, so its value is masked whatever it looks like.
    [new RegExp(`("${KEY}"\\s{0,5}:\\s{0,5})${NOT_MASKED}"(?:\\\\.|[^"\\\\\\n])*"`, 'gi'), `$1"${MASK}"`],
    [new RegExp(`(${KEY}${SEP})${NOT_MASKED}(["'])(?=[^"'\\s]{0,200}[0-9!@#$%^*+/=_\\-])[^"'\\s]{6,}\\2`, 'gi'), `$1$2${MASK}$2`],
    [new RegExp(`(${KEY}${SEP})${NOT_MASKED}${SECRETISH}`, 'gi'), `$1${MASK}`],
  ],
};

export function redactSecrets(text: string, mode: RedactMode = 'prose'): string {
  let out = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) : text;
  for (const [pattern, replacement] of COMMON) out = out.replace(pattern, replacement);
  out = maskCookieHeaders(out);
  for (const [pattern, replacement] of KEY_VALUE[mode]) out = out.replace(pattern, replacement);
  return out;
}
