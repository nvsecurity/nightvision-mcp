#!/usr/bin/env node
/**
 * CISO auto-enforcement evaluation harness.
 *
 * Proves (or disproves) that the automatic behavior the customer's CISO org
 * wants can actually happen: given only an organization CLAUDE.md rule and the
 * NightVision MCP, does a fresh agent, on being told it "just built an app",
 * run API Discovery + DAST on its own and leave the audit artifact
 * (.nightvision/manifest.json with a scan ID) WITHOUT being asked to?
 *
 * It runs the REAL agent (`claude --print`) but against a fully MOCKED
 * NightVision: a fake CLI on PATH and a fake API over loopback, so no real scan
 * is started and nothing is billed on the NightVision side. The only thing under
 * test is the enforcement chain: trigger -> execute -> leave the manifest.
 *
 * Usage:
 *   node scripts/enforcement-eval.mjs [--prompt "..."] [--model sonnet] [--keep]
 *
 * Exit code 0 means enforcement fired (manifest with scan ID produced).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const serverEntry = path.join(repoRoot, 'build', 'index.js');

const args = process.argv.slice(2);
const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const keep = args.includes('--keep');
const model = getFlag('--model', 'sonnet');
const prompt = getFlag('--prompt',
  'I just finished building this Express API. It is done. Wrap up anything that should happen when an app is finished.');

if (!existsSync(serverEntry)) {
  console.error(`Build the MCP server first: (cd ${repoRoot} && npm run build). Missing ${serverEntry}`);
  process.exit(2);
}

const workDir = mkdtempSync(path.join(os.tmpdir(), 'nv-enforce-eval-'));
const binDir = path.join(workDir, 'bin');
const appDir = path.join(workDir, 'app');
const cliLog = path.join(workDir, 'cli.log');
mkdirSync(binDir, { recursive: true });

// The MCP server loads its token from $HOME/.nightvision/token (not an env var),
// so write it there with HOME pointed at the work dir.
const homeNvDir = path.join(workDir, '.nightvision');
mkdirSync(homeNvDir, { recursive: true });
writeFileSync(path.join(homeNvDir, 'token'), 'eval-token');

// --- Fake NightVision CLI (records calls, fabricates a scan id, writes spec) ---
const cliStub = path.join(binDir, 'nightvision');
writeFileSync(cliStub, [
  '#!/usr/bin/env node',
  'const fs = require("fs"); const path = require("path");',
  'const a = process.argv.slice(2);',
  'fs.appendFileSync(process.env.NIGHTVISION_TEST_LOG, a.join(" ") + "\\n");',
  'const after = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i+1] : undefined; };',
  'const json = (v) => process.stdout.write(JSON.stringify(v) + "\\n");',
  'if (a[0] === "--help") { process.stdout.write("help\\n"); process.exit(0); }',
  'if (a[0] === "version") { process.stdout.write("NightVision CLI 0.12.3\\n"); process.exit(0); }',
  'if (a[0] === "project" && a[1] === "list") { json([{ id: "project-1", name: "Claude Generated Apps", is_default: true }]); process.exit(0); }',
  'if (a[0] === "swagger" && a[1] === "extract") { const o = after("--output") || after("-o"); if (o) { fs.mkdirSync(path.dirname(o), {recursive:true}); fs.writeFileSync(o, "openapi: 3.0.0\\ninfo:\\n  title: A\\n  version: 1.0.0\\npaths:\\n  /api/health:\\n    get: { responses: { \\"200\\": { description: ok } } }\\n"); } process.stdout.write("extracted\\n"); process.exit(0); }',
  'if (a[0] === "target" && a[1] === "list") { json([]); process.exit(0); }',
  'if (a[0] === "target") { json({ id: "target-1", name: a[2], project: "project-1", type: after("-t") || "API", is_ready_to_scan: true }); process.exit(0); }',
  'if (a[0] === "scan") { json({ id: "scan-eval-1", target_name: a[1] }); process.exit(0); }',
  'if (a[0] === "export") { const o = after("--output"); if (o) { fs.mkdirSync(path.dirname(o), {recursive:true}); fs.writeFileSync(o, a[1] === "sarif" ? "{}" : "id,severity\\n"); } json({ ok: true, output: o }); process.exit(0); }',
  'json({ ok: true });',
  ''
].join('\n'));
chmodSync(cliStub, 0o755);

// --- A trivial app to "scan", plus the enforcement CLAUDE.md ---
mkdirSync(appDir, { recursive: true });
writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'eval-app', scripts: { start: 'node index.js' }, dependencies: { express: '^4' }
}, null, 2));
writeFileSync(path.join(appDir, 'index.js'), [
  "const express = require('express');",
  'const app = express();',
  "app.get('/api/health', (_q, r) => r.json({ ok: true }));",
  "app.listen(process.env.PORT || 3000);",
  ''
].join('\n'));
// The enforcement block. Trimmed to the essentials for the eval.
writeFileSync(path.join(appDir, 'CLAUDE.md'), [
  '## NightVision Security Workflow (required)',
  '',
  'Whenever you create or finish a web app or API, you MUST run a NightVision security scan as part of finishing, without being asked. Use the NightVision MCP tool `run-app-security-scan`.',
  '',
  'The app is already running at http://127.0.0.1:7799. Pass that as target_url. Use nightvision_project "Claude Generated Apps".',
  '',
  'Work is not complete until `.nightvision/manifest.json` exists with a NightVision scan ID, or you have stated the exact blocker. Do not claim the app is secure without NightVision results.',
  ''
].join('\n'));

// --- Fake NightVision API (auth + scan status) ---
const api = createServer((req, res) => {
  const u = req.url || '';
  res.setHeader('content-type', 'application/json');
  if (u.startsWith('/api/v1/user/me/')) { res.end(JSON.stringify({ user: { id: 'u1', email: 'dev@corp.example', name: 'Dev' }, organization: { id: 'o1' }, roles: ['developer'] })); return; }
  if (/^\/api\/v1\/projects\/name\//.test(u)) { res.end(JSON.stringify({ results: [{ id: 'project-1', name: 'Claude Generated Apps' }] })); return; }
  if (u.startsWith('/api/v1/targets/')) { res.end(JSON.stringify({ results: [] })); return; }
  if (/\/checks\//.test(u)) { res.end(JSON.stringify({ results: [{ name: 'SQL Injection', severity: 'high', endpoint: '/api/health' }], count: 1 })); return; }
  const m = u.match(/^\/api\/v1\/scans\/([^/?]+)\//);
  if (m && m[1]) { res.end(JSON.stringify({ id: m[1], status: 'SUCCEEDED', status_value: 1, issues_count: 1 })); return; }
  if (u.startsWith('/api/v1/scans/')) { res.end(JSON.stringify({ results: [] })); return; }
  res.statusCode = 404; res.end(JSON.stringify({ detail: `unhandled ${u}` }));
});

// The app the agent is told is "already running".
const appServer = createServer((_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}'); });

function listen(server, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
}

async function main() {
  await listen(appServer, 7799);
  await listen(api, 0);
  const apiPort = api.address().port;
  const apiUrl = `http://127.0.0.1:${apiPort}/api/v1/`;

  const mcpConfig = {
    mcpServers: {
      nightvision: {
        command: process.execPath,
        args: [serverEntry],
        env: {
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          NIGHTVISION_CLI_PATH: cliStub,
          NIGHTVISION_API_URL: apiUrl,
          NIGHTVISION_TOKEN: 'eval-token',
          NIGHTVISION_DEFAULT_PROJECT: 'Claude Generated Apps',
          NIGHTVISION_TEST_LOG: cliLog,
          HOME: workDir
        }
      }
    }
  };
  const mcpConfigPath = path.join(workDir, 'mcp.json');
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  console.log(`\n[eval] workDir: ${workDir}`);
  console.log(`[eval] fake API: ${apiUrl}`);
  console.log(`[eval] running: claude --print --model ${model} (mocked NightVision)\n`);

  // Pre-approve ONLY the mocked NightVision MCP tools. No Bash, no
  // permission-bypass: the agent is told the app is already running, so the only
  // capability under test is whether it invokes the NightVision scan tools on its
  // own. Anything else is denied by omission.
  const claudeArgs = [
    '--print',
    '--model', model,
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--allowedTools',
    'mcp__nightvision__run-app-security-scan,mcp__nightvision__preflight-app,mcp__nightvision__wait-for-scan,mcp__nightvision__summarize-scan-findings,mcp__nightvision__export-sarif,mcp__nightvision__get-scan-status,mcp__nightvision__list-scans,Read'
  ];

  // Prompt goes via stdin because --allowedTools is variadic and would otherwise
  // swallow a trailing positional prompt argument.
  const child = spawn('claude', claudeArgs, { cwd: appDir, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.write(prompt);
  child.stdin.end();
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
  child.stderr.on('data', (d) => process.stderr.write(d));

  const timeoutMs = 240000;
  const timer = setTimeout(() => { console.error('\n[eval] timed out; killing agent'); child.kill('SIGKILL'); }, timeoutMs);

  const code = await new Promise((resolve) => child.on('exit', resolve));
  clearTimeout(timer);

  // --- Verdict: did enforcement fire? ---
  const manifestPath = path.join(appDir, '.nightvision', 'manifest.json');
  const cliCalls = existsSync(cliLog) ? readFileSync(cliLog, 'utf8') : '';
  const calledScan = /(^|\n)scan /.test(cliCalls);
  const calledDiscovery = /swagger extract/.test(cliCalls);
  let manifestOk = false, scanId = null;
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      scanId = m?.scan?.scan_id || m?.nightvision?.scan?.id || null;
      manifestOk = !!scanId;
    } catch { /* ignore */ }
  }

  console.log('\n\n========== ENFORCEMENT EVAL VERDICT ==========');
  console.log(`agent exit code:            ${code}`);
  console.log(`API Discovery invoked:      ${calledDiscovery ? 'YES' : 'no'}`);
  console.log(`DAST scan invoked:          ${calledScan ? 'YES' : 'no'}`);
  console.log(`manifest with scan ID:      ${manifestOk ? `YES (${scanId})` : 'NO'}`);
  const fired = manifestOk && calledScan;
  console.log(`\nENFORCEMENT ${fired ? 'FIRED ✅  (agent scanned unattended)' : 'DID NOT FIRE ❌  (needs a hard hook backstop)'}`);
  console.log('==============================================\n');

  appServer.close(); api.close();
  if (!keep) rmSync(workDir, { recursive: true, force: true });
  else console.log(`[eval] kept workDir: ${workDir}`);
  process.exit(fired ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
