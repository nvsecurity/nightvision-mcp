import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from './redact.js';
import { esc, renderReportHtml } from './render-html.js';
import { buildScanReport } from './model.js';
import { chromePrintArgs, findChromeBinary, isCompletePdf, printHtmlToPdf } from './pdf.js';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('redactSecrets masks common credential shapes and leaves prose alone', () => {
  const input = [
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'aws AKIAIOSFODNN7EXAMPLE',
    'Authorization: Bearer abc.def.ghi-jkl_mno',
    '"password": "hunter22"',
    'api_key=sk_live_1234567890abcdef',
    'The login form is missing a CSRF token.',
  ].join('\n');
  const out = redactSecrets(input);
  assert.doesNotMatch(out, /eyJhbGci|AKIAIOSFODNN7EXAMPLE|abc\.def\.ghi|hunter22|sk_live_1234/);
  assert.match(out, /The login form is missing a CSRF token\./);
  assert.match(out, /Authorization: \[REDACTED\]/);
});

test('esc neutralizes HTML metacharacters', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
});

test('rendered report escapes target-derived content and forbids scripts and network', () => {
  const hostile = '<script>alert(1)</script>';
  const report = buildScanReport({
    scan: { id: 's', target_name: hostile, status_value: 'SUCCEEDED', location: 'http://x.test' },
    issues: [{
      id: 'i', kind_id: 1, kind: { id: 1, name: hostile }, severity: 'HIGH', resolution: 0,
      http_method: 'GET', url_path: `/a"><svg onload=alert(1)>`, parameter_name: hostile,
      payload: hostile, ai_explanation: `Reflected \`${hostile}\` in **body**`, extra_info: {},
    }],
    pathsTested: 1,
    specFile: null,
    sourceLinks: new Map(),
    options: {
      minSeverity: 'low', includeEvidence: false, maxOccurrencesPerType: 5, generatedAt: new Date('2026-09-29T00:00:00Z'),
      executiveSummary: `Fix ${hostile} first.\n\n- one\n- two`,
      remediationNotes: [{ issue_type: hostile, note: hostile }],
    },
  });
  const html = renderReportHtml(report);
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /<svg onload/i);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"/);
  // Backtick spans render as code, emphasis markers are dropped, contents stay escaped.
  assert.match(html, /<code>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code> in body/);
  assert.match(html, /<ul class="bullets"><li>one<\/li><li>two<\/li><\/ul>/);
});

test('rendered report has no emdashes or en dashes (house copy rule)', () => {
  const report = buildScanReport({
    scan: { id: 's', target_name: 'api', status_value: 'SUCCEEDED' },
    issues: [],
    pathsTested: null,
    specFile: null,
    sourceLinks: new Map(),
    baseline: { scan: { id: 'b' }, issues: [] },
    options: { minSeverity: 'low', includeEvidence: false, maxOccurrencesPerType: 5, generatedAt: new Date() },
  });
  assert.doesNotMatch(renderReportHtml(report), /[–—]/);
});

test('findChromeBinary honors the override, then platform locations, then PATH', () => {
  const has = (set: string[]) => (p: string) => set.includes(p);
  assert.equal(findChromeBinary({ NIGHTVISION_CHROME_PATH: '/opt/c' }, 'linux', has(['/opt/c'])), '/opt/c');
  assert.equal(
    findChromeBinary({ HOME: '/Users/u' }, 'darwin', has(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'])),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  );
  assert.equal(findChromeBinary({ PATH: '/usr/bin:/snap/bin' }, 'linux', has(['/snap/bin/chromium'])), '/snap/bin/chromium');
  assert.equal(findChromeBinary({ PATH: '/usr/bin' }, 'linux', has([])), null);
});

test('chromePrintArgs uses new headless, a throwaway profile, and adds --no-sandbox only as root', () => {
  const args = chromePrintArgs('/tmp/r/report.html', '/out/r.pdf', '/tmp/profile', false);
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--user-data-dir=/tmp/profile'));
  assert.ok(args.includes('--print-to-pdf=/out/r.pdf'));
  assert.equal(args.at(-1), 'file:///tmp/r/report.html');
  assert.ok(!args.includes('--no-sandbox'));
  assert.ok(chromePrintArgs('/a.html', '/b.pdf', '/p', true).includes('--no-sandbox'));
});

test('redactSecrets leaves ordinary scanner prose alone', () => {
  const prose = 'Basic authentication over HTTP exposes credentials. Token expiration is not enforced. The bypass flag is on.';
  assert.equal(redactSecrets(prose), prose);
});

test('redactSecrets masks cut-off secrets, quoted values with spaces, and session keys', () => {
  assert.doesNotMatch(redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA'), /MIIEow/);
  assert.doesNotMatch(redactSecrets('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozj'), /eyJzdWIi/);
  assert.equal(redactSecrets('{"password": "my pass phrase"}'), '{"password": "[REDACTED]"}');
  assert.equal(redactSecrets('JSESSIONID=ABC123DEF456; Path=/'), 'JSESSIONID=[REDACTED]; Path=/');
  assert.equal(redactSecrets('user=a&pass=hunter22'), 'user=a&pass=[REDACTED]');
  assert.equal(redactSecrets('{"bypass": "yes"}'), '{"bypass": "yes"}');
});

test('scan window times use a 24-hour clock that never shows hour 24', () => {
  const report = buildScanReport({
    scan: { id: 's', target_name: 'api', status_value: 'SUCCEEDED', started_at: '2026-09-29T00:05:00Z', ended_at: '2026-09-29T00:20:00Z' },
    issues: [],
    pathsTested: null,
    specFile: null,
    sourceLinks: new Map(),
    options: { minSeverity: 'low', includeEvidence: false, maxOccurrencesPerType: 5, generatedAt: new Date() },
  });
  const html = renderReportHtml(report);
  assert.match(html, /00:05 UTC to Sep 29, 2026, 00:20 UTC/);
  assert.doesNotMatch(html, /24:05/);
});

async function fakeChrome(dir: string, body: string): Promise<string> {
  // Stands in for Chrome: reads --print-to-pdf=<path> and writes `body` there.
  const script = path.join(dir, 'fake-chrome.mjs');
  await writeFile(script, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const arg = process.argv.find((a) => a.startsWith('--print-to-pdf='));
writeFileSync(arg.slice('--print-to-pdf='.length), ${JSON.stringify(body)});
`);
  await chmod(script, 0o755);
  return script;
}

test('isCompletePdf requires both the header and the EOF marker', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nv-pdf-test-'));
  try {
    await writeFile(path.join(dir, 'ok.pdf'), '%PDF-1.7\n1 0 obj\n%%EOF\n');
    await writeFile(path.join(dir, 'cut.pdf'), '%PDF-1.7\n1 0 obj\nstream partial');
    assert.equal(await isCompletePdf(path.join(dir, 'ok.pdf')), true);
    assert.equal(await isCompletePdf(path.join(dir, 'cut.pdf')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('printHtmlToPdf replaces the output only with a complete PDF', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nv-pdf-test-'));
  try {
    const html = path.join(dir, 'r.html');
    const out = path.join(dir, 'report.pdf');
    await writeFile(html, '<p>x</p>');
    await writeFile(out, 'previous report');

    await assert.rejects(printHtmlToPdf(html, out, await fakeChrome(dir, '%PDF-1.7 truncated'), 10_000), /incomplete or invalid/);
    assert.equal(await readFile(out, 'utf8'), 'previous report');

    await printHtmlToPdf(html, out, await fakeChrome(dir, '%PDF-1.7\nbody\n%%EOF\n'), 10_000);
    assert.equal(await readFile(out, 'utf8'), '%PDF-1.7\nbody\n%%EOF\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
