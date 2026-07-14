/**
 * End-to-end workflow scenarios driven the way a non-technical developer would
 * drive them through an agent: "scan the app I just built", "is it ready?",
 * "what did it find?". Each test exercises the real MCP server over stdio with a
 * fake NightVision CLI and a fake NightVision API, and asserts the guardrails
 * that make unattended, CISO-mandated scanning safe:
 *
 *   - never claim a scan happened without a real scan id + manifest
 *   - never attack the wrong target
 *   - a long scan returns fast (scan id now, results later)
 *   - a transient outage is not misreported as a bad token
 *   - exports refuse to emit empty/misleading results
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'index.js');
const isWin = process.platform === 'win32';

// ---------- JSON-RPC client over the MCP server's stdio ----------

function createClient(child: ChildProcess) {
  const pending = new Map<number, (msg: any) => void>();
  let nextId = 1;
  let buf = '';
  let stderr = '';
  let exited: string | null = null;

  child.stdout!.on('data', (d) => {
    buf += d.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      } catch {
        // Ignore non-JSON stdout.
      }
    }
  });
  child.stderr!.on('data', (d) => { stderr += d.toString(); });
  child.on('exit', (code) => {
    exited = `server exited early (code ${code})`;
    for (const resolve of pending.values()) resolve({ error: { message: exited } });
    pending.clear();
  });

  const send = (obj: any) => child.stdin!.write(JSON.stringify(obj) + '\n');
  const rpc = (method: string, params: any, timeoutMs = 20000): Promise<any> =>
    new Promise((resolve, reject) => {
      if (exited) { reject(new Error(`${exited}\n${stderr}`)); return; }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timed out waiting for ${method}\n${stderr}`));
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method} failed: ${JSON.stringify(msg.error)}\n${stderr}`));
        else resolve(msg);
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  const notify = (method: string, params?: any) => send({ jsonrpc: '2.0', method, params });
  return { rpc, notify };
}

// ---------- Configurable fake NightVision CLI ----------

// A node-based CLI stub. Scan behavior is driven by env so tests can make the
// scan quiet, fast, or failing without new stubs.
function fakeCli(baseDir: string): { binDir: string; logPath: string } {
  const binDir = path.join(baseDir, 'bin');
  const logPath = path.join(baseDir, 'nightvision-args.log');
  mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, 'nightvision');
  writeFileSync(stub, [
    '#!/usr/bin/env node',
    'const fs = require("fs");',
    'const path = require("path");',
    'const args = process.argv.slice(2);',
    'fs.appendFileSync(process.env.NIGHTVISION_TEST_LOG, `${args.join(" ")}\\n`);',
    'function argAfter(f){const i=args.indexOf(f);return i>=0?args[i+1]:undefined;}',
    'function json(v){process.stdout.write(`${JSON.stringify(v)}\\n`);}',
    'if (args[0] === "--help") { process.stdout.write("help\\n"); process.exit(0); }',
    'if (args[0] === "version") { process.stdout.write("NightVision CLI 0.12.3\\n"); process.exit(0); }',
    'if (args[0] === "project" && args[1] === "list") { json(JSON.parse(process.env.NV_FAKE_PROJECTS || "[]")); process.exit(0); }',
    'if (args[0] === "swagger" && args[1] === "extract") {',
    '  const o = argAfter("--output") || argAfter("-o");',
    '  if (o) { fs.mkdirSync(path.dirname(o), {recursive:true}); fs.writeFileSync(o, "openapi: 3.0.0\\ninfo:\\n  title: A\\n  version: 1.0.0\\npaths: {}\\n"); }',
    '  process.stdout.write("extracted\\n"); process.exit(0);',
    '}',
    'if (args[0] === "target" && args[1] === "list") { json([]); process.exit(0); }',
    'if (args[0] === "target" && (args[1] === "create" || args[1] === "update")) {',
    '  json({ id: "target-1", name: args[2], project: "project-1", type: argAfter("-t") || "API", is_ready_to_scan: true }); process.exit(0);',
    '}',
    'if (args[0] === "scan") {',
    '  if (process.env.NV_SCAN_QUIET === "1") { process.exit(0); }',
    '  json({ id: process.env.NV_SCAN_ID || "scan-123", target_name: args[1] }); process.exit(0);',
    '}',
    'if (args[0] === "export") {',
    '  const o = argAfter("--output");',
    '  if (o) { fs.mkdirSync(path.dirname(o), {recursive:true}); fs.writeFileSync(o, args[1] === "sarif" ? "{}" : "id,severity\\n"); }',
    '  json({ ok: true, output: o }); process.exit(0);',
    '}',
    'json({ ok: true });',
    ''
  ].join('\n'));
  chmodSync(stub, 0o755);
  return { binDir, logPath };
}

// ---------- Configurable fake NightVision API ----------

interface ApiConfig {
  userMe?: 'ok' | 'unauthorized' | 'server_error';
  projects?: Array<{ id: string; name: string }>;
  // Scan status returned by /scans/<id>/. Provide a fixed status or a sequence.
  scanStatus?: any;
  scanStatusSequence?: any[];
  checks?: any[];
  // Scans returned by the list endpoint (used by managed-scan baseline/lookup).
  listScans?: any[];
  // Targets returned by the target lookup endpoint. Empty means the harness creates one.
  targets?: any[];
}

async function fakeApi(config: ApiConfig): Promise<{ server: Server; url: string; captured: { checkParams: string[] } } | null> {
  const captured = { checkParams: [] as string[] };
  let statusPolls = 0;
  const projects = config.projects || [{ id: 'project-1', name: 'Demo Project' }];

  const server = createServer((req, res) => {
    const u = req.url || '';
    res.setHeader('content-type', 'application/json');

    if (u.startsWith('/api/v1/user/me/')) {
      if (config.userMe === 'unauthorized') { res.statusCode = 401; res.end(JSON.stringify({ detail: 'Invalid token.' })); return; }
      if (config.userMe === 'server_error') { res.statusCode = 500; res.end(JSON.stringify({ detail: 'boom' })); return; }
      res.end(JSON.stringify({ user: { id: 'user-1', email: 'dev@example.com', name: 'Dev' }, organization: { id: 'org-1' }, roles: ['developer'] }));
      return;
    }

    const nameMatch = u.match(/^\/api\/v1\/projects\/name\/([^/]+)\//);
    if (nameMatch) {
      const wanted = decodeURIComponent(nameMatch[1]);
      const found = projects.filter((p) => p.name === wanted);
      res.end(JSON.stringify({ results: found }));
      return;
    }

    if (u.startsWith('/api/v1/targets/')) {
      res.end(JSON.stringify({ results: config.targets || [] }));
      return;
    }

    const checksMatch = u.match(/^\/api\/v1\/scans\/[^/]+\/checks\/\??(.*)$/);
    if (checksMatch) {
      captured.checkParams.push(checksMatch[1]);
      res.end(JSON.stringify({ results: config.checks || [], count: (config.checks || []).length }));
      return;
    }

    const statusMatch = u.match(/^\/api\/v1\/scans\/([^/?]+)\/(\?.*)?$/);
    if (statusMatch && statusMatch[1] !== '') {
      let body = config.scanStatus || { id: statusMatch[1], status: 'RUNNING', status_value: 2 };
      if (config.scanStatusSequence) {
        body = config.scanStatusSequence[Math.min(statusPolls, config.scanStatusSequence.length - 1)];
        statusPolls += 1;
      }
      res.end(JSON.stringify(body));
      return;
    }

    if (u.startsWith('/api/v1/scans/')) {
      res.end(JSON.stringify({ results: config.listScans || [] }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ detail: `Unhandled: ${u}` }));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error: any) {
    if (error?.code === 'EPERM') return null;
    throw error;
  }
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/api/v1/`, captured };
}

async function startLocalApp(): Promise<{ server: Server; url: string } | null> {
  const server = createServer((_req, res) => { res.writeHead(200); res.end('{"ok":true}'); });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error: any) {
    if (error?.code === 'EPERM') return null;
    throw error;
  }
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function makeApp(baseDir: string): string {
  const p = path.join(baseDir, 'app');
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, 'package.json'), JSON.stringify({ dependencies: { express: '^4' } }));
  writeFileSync(path.join(p, 'index.js'), "const e=require('express')();e.get('/api/health',(_q,r)=>r.json({ok:true}));\n");
  return p;
}

function spawnServer(baseDir: string, binDir: string, logPath: string, opts: { token?: string; apiUrl?: string; env?: Record<string, string> } = {}): ChildProcess {
  const homeDir = path.join(baseDir, 'home');
  mkdirSync(homeDir, { recursive: true });
  if (opts.token) {
    const nvDir = path.join(homeDir, '.nightvision');
    mkdirSync(nvDir, { recursive: true });
    writeFileSync(path.join(nvDir, 'token'), opts.token);
  }
  return spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      HOME: homeDir,
      NIGHTVISION_TOKEN: '',
      NIGHTVISION_TEST_LOG: logPath,
      ...(opts.env || {}),
      ...(opts.apiUrl ? { NIGHTVISION_API_URL: opts.apiUrl } : {})
    }
  });
}

async function init(child: ChildProcess) {
  const client = createClient(child);
  await client.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scenario', version: '0' } });
  client.notify('notifications/initialized');
  return client;
}

async function call(client: Awaited<ReturnType<typeof init>>, name: string, args: Record<string, unknown>) {
  const response = await client.rpc('tools/call', { name, arguments: args }, 30000);
  const text = response.result?.content?.[0]?.text;
  assert.equal(typeof text, 'string', `${name} should return text`);
  return { payload: JSON.parse(text), isError: !!response.result?.isError };
}

const skip = isWin ? 'requires a POSIX shell stub' : false;

// ---------- Scenarios ----------

test('scenario: "scan the app I just built" runs the full workflow and produces a scan id + manifest', { timeout: 30000, skip }, async (t) => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-happy-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const projectPath = makeApp(baseDir);
  const app = await startLocalApp();
  if (!app) return t.skip('loopback blocked');
  const api = await fakeApi({
    scanStatusSequence: [
      { id: 'scan-123', status: 'RUNNING', status_value: 2 },
      { id: 'scan-123', status: 'SUCCEEDED', status_value: 1, issues_count: 2 }
    ],
    checks: [{ name: 'SQL Injection', severity: 'high', endpoint: '/api/users' }]
  });
  if (!api) { app.server.close(); return t.skip('loopback blocked'); }
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api.url });

  try {
    const client = await init(child);

    // 1. The agent starts the guided scan. It must come back quickly with a scan
    //    id and manifest, WITHOUT waiting for the whole DAST run.
    const started = await call(client, 'run-app-security-scan', {
      project_path: projectPath, target_url: app.url, nightvision_project: 'Demo Project', no_auth: true
    });
    assert.equal(started.payload.ok, true);
    assert.equal(started.payload.status, 'running');
    assert.equal(started.payload.data.scan.scan_id, 'scan-123');
    const manifestPath = started.payload.data.manifest_path;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.scan.scan_id, 'scan-123');

    // 2. Later, the agent polls for completion.
    const waited = await call(client, 'wait-for-scan', { scan_id: 'scan-123', timeout_seconds: 5, poll_interval_seconds: 1 });
    assert.equal(waited.payload.ok, true);
    assert.equal(waited.payload.data.terminal_status, 'succeeded');

    // 3. Then summarizes findings and exports SARIF.
    const summary = await call(client, 'summarize-scan-findings', { scan_id: 'scan-123' });
    assert.equal(summary.payload.ok, true);

    const sarif = await call(client, 'export-sarif', { scan_id: 'scan-123', output: path.join(baseDir, 'out.sarif') });
    assert.equal(sarif.payload.ok, true);
    assert.equal(sarif.payload.data.sarif_path, path.join(baseDir, 'out.sarif'));
  } finally {
    child.kill('SIGKILL');
    app.server.close();
    api.server.close();
  }
});

test('scenario: an EXISTING target gets its fresh spec uploaded by swagger extract itself, before the scan starts', { timeout: 30000, skip }, async (t) => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-existing-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const projectPath = makeApp(baseDir);
  const app = await startLocalApp();
  if (!app) return t.skip('loopback blocked');
  const api = await fakeApi({
    // The target already exists, so `swagger extract --target` can upload onto it.
    targets: [{ id: 'target-1', name: 'demo-api', project: 'project-1', project_name: 'Demo Project', location: 'http://localhost:1', type: 'OPENAPI' }],
    scanStatus: { id: 'scan-123', status: 'RUNNING', status_value: 2 }
  });
  if (!api) { app.server.close(); return t.skip('loopback blocked'); }
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api.url });

  try {
    const client = await init(child);
    const started = await call(client, 'run-app-security-scan', {
      project_path: projectPath, target_url: app.url, nightvision_project: 'Demo Project',
      target_name: 'demo-api', no_auth: true
    });
    assert.equal(started.payload.ok, true);
    assert.equal(started.payload.data.api_discovery.status, 'success');
    assert.equal(started.payload.data.api_discovery.spec_uploaded, true);

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const extract = lines.find((l) => l.startsWith('swagger extract'));
    assert.ok(extract, 'swagger extract should have run');

    // The fresh spec is uploaded by extract itself, onto the existing target.
    assert.match(extract!, /--target demo-api/);
    assert.ok(!extract!.includes('--no-upload'), `extract must not skip the upload: ${extract}`);

    // And it is NOT pushed a second time by a separate target update (-f is --spec-file).
    const update = lines.find((l) => l.startsWith('target update'));
    if (update) {
      assert.ok(
        !/(?:^| )(?:-f|--spec-file) /.test(update),
        `spec should not be pushed twice: ${update}`
      );
    }

    // Ordering is what matters: the spec lands BEFORE the scan starts.
    const extractIdx = lines.findIndex((l) => l.startsWith('swagger extract'));
    const scanIdx = lines.findIndex((l) => l.startsWith('scan'));
    assert.ok(scanIdx > extractIdx, 'DAST must start only after API discovery uploaded the spec');
  } finally {
    child.kill('SIGKILL');
    app.server.close();
    api.server.close();
  }
});

test('scenario: a NEW target still gets its spec at create time (extract cannot upload to a target that does not exist yet)', { timeout: 30000, skip }, async (t) => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-newtarget-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const projectPath = makeApp(baseDir);
  const app = await startLocalApp();
  if (!app) return t.skip('loopback blocked');
  const api = await fakeApi({ targets: [], scanStatus: { id: 'scan-123', status: 'RUNNING', status_value: 2 } });
  if (!api) { app.server.close(); return t.skip('loopback blocked'); }
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api.url });

  try {
    const client = await init(child);
    const started = await call(client, 'run-app-security-scan', {
      project_path: projectPath, target_url: app.url, nightvision_project: 'Demo Project',
      target_name: 'brand-new-api', no_auth: true
    });
    assert.equal(started.payload.ok, true);
    assert.equal(started.payload.data.api_discovery.spec_uploaded, false);

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const extract = lines.find((l) => l.startsWith('swagger extract'))!;

    // No target to upload onto yet, so extract stays local...
    assert.ok(extract.includes('--no-upload'), `extract should not try to upload: ${extract}`);
    assert.ok(!extract.includes('--target'), `extract must not name a target that does not exist: ${extract}`);

    // ...and the spec is attached when the target is created (-f is --spec-file), as type API.
    const create = lines.find((l) => l.startsWith('target create'));
    assert.ok(create, 'target create should have run');
    assert.match(create!, /(?:^| )(?:-f|--spec-file) \S+openapi/);
    assert.match(create!, /(?:^| )(?:-t|--type) API/);
  } finally {
    child.kill('SIGKILL');
    app.server.close();
    api.server.close();
  }
});

test('scenario: "scan my app" with the app stopped never fakes success; it blocks with a concrete reason', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-stopped-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const projectPath = makeApp(baseDir);
  const api = await fakeApi({});
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    const res = await call(client, 'run-app-security-scan', {
      project_path: projectPath, target_url: 'http://127.0.0.1:1', nightvision_project: 'Demo Project', no_auth: true, timeout_seconds: 2
    });
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.status, 'blocked');
    assert.ok(res.payload.blockers.includes('runtime_url_not_reachable'));
    // No scan should have been started.
    const cli = readFileSync(logPath, 'utf8');
    assert.doesNotMatch(cli, /^scan /m);
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: a transient NightVision outage is reported as unavailable, NOT as an expired token', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-outage-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const api = await fakeApi({ userMe: 'server_error' });
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    const res = await call(client, 'list-scans', { project: 'Demo Project' });
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.error.code, 'NIGHTVISION_API_UNAVAILABLE');
    assert.ok(res.payload.blockers.includes('nightvision_api_unavailable'));
    // Must NOT tell the user their token is expired.
    assert.doesNotMatch(JSON.stringify(res.payload), /expired/i);
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: preflight-app during an outage reports unavailability, NOT an expired token', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-preflight-outage-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const api = await fakeApi({ userMe: 'server_error' });
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    const res = await call(client, 'preflight-app', { project_path: baseDir });
    const blockers = res.payload?.data?.blockers ?? res.payload?.error?.details?.blockers ?? [];
    // A valid-but-unreachable token must be classified as an outage, not a
    // re-login prompt, so an unattended workflow retries instead of stalling.
    assert.ok(blockers.includes('nightvision_api_unavailable'));
    assert.ok(!blockers.includes('invalid_or_expired_token'));
    assert.doesNotMatch(JSON.stringify(res.payload), /expired/i);
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: a genuinely invalid token (401) IS reported as expired/invalid', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-401-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const api = await fakeApi({ userMe: 'unauthorized' });
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    const res = await call(client, 'list-scans', { project: 'Demo Project' });
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.error.code, 'INVALID_OR_EXPIRED_TOKEN');
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: a project whose NAME looks like a UUID is not falsely denied', { timeout: 30000, skip }, async () => {
  const uuidName = '123e4567-e89b-12d3-a456-426614174000';
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-uuidproj-'));
  const { binDir, logPath } = fakeCli(baseDir);
  // CLI `project list` (used by id lookup) has a DIFFERENT id, so id lookup
  // misses and the guard must fall back to name lookup via the API.
  const api = await fakeApi({ projects: [{ id: 'real-project-id', name: uuidName }] });
  const child = spawnServer(baseDir, binDir, logPath, {
    token: 't', apiUrl: api!.url, env: { NV_FAKE_PROJECTS: JSON.stringify([{ id: 'real-project-id', name: uuidName }]) }
  });

  try {
    const client = await init(child);
    const res = await call(client, 'start-scan', { target_name: 'my-target', project: uuidName });
    // The guard must NOT deny access; the scan proceeds (and returns a scan id).
    assert.notEqual(res.payload?.error?.code, 'PROJECT_ACCESS_DENIED');
    if (res.payload.ok) {
      assert.equal(res.payload.data.scan_id, 'scan-123');
    }
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: exporting a still-running scan refuses to emit an empty SARIF', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-exprun-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const api = await fakeApi({ scanStatus: { id: 'scan-9', status: 'RUNNING', status_value: 2 } });
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    const res = await call(client, 'export-sarif', { scan_id: 'scan-9', output: path.join(baseDir, 'x.sarif') });
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.error.code, 'SCAN_NOT_TERMINAL');
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: exporting a failed scan with NO findings blocks instead of returning success', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-expfail-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const api = await fakeApi({ scanStatus: { id: 'scan-9', status: 'FAILED', status_value: 4, issues_count: 0 } });
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    const res = await call(client, 'export-sarif', { scan_id: 'scan-9', output: path.join(baseDir, 'x.sarif') });
    assert.equal(res.payload.ok, false);
    assert.equal(res.payload.error.code, 'SCAN_NO_FINDINGS');
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: exporting a FAILED scan that DID find issues still works (failed != useless)', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-expfailfind-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const api = await fakeApi({ scanStatus: { id: 'scan-9', status: 'FAILED', status_value: 4, issues_count: 7 } });
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    const res = await call(client, 'export-sarif', { scan_id: 'scan-9', output: path.join(baseDir, 'x.sarif') });
    assert.equal(res.payload.ok, true);
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: get-scan-checks with an explicit empty severity list still filters (does not flood)', { timeout: 30000, skip }, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-emptyfilter-'));
  const { binDir, logPath } = fakeCli(baseDir);
  const api = await fakeApi({ checks: [] });
  const child = spawnServer(baseDir, binDir, logPath, { token: 't', apiUrl: api!.url });

  try {
    const client = await init(child);
    await call(client, 'get-scan-checks', { scan_id: 'scan-9', severity: [], status: [] });
    // The request the server actually made must carry the default severity
    // filters, not an empty (unfiltered) query.
    const q = api!.captured.checkParams.join('&');
    assert.match(q, /severity=CRITICAL/);
    assert.match(q, /severity=HIGH/);
  } finally {
    child.kill('SIGKILL');
    api!.server.close();
  }
});

test('scenario: a non-executable CLI binary is treated as not-installed (server refuses to boot)', { timeout: 30000, skip }, async () => {
  // Regression for the isInstalled fix: a present-but-broken binary (EACCES) must
  // NOT be treated as installed. Startup gates on CLI availability, so pinning the
  // CLI path at a non-executable file makes the server exit early instead of
  // pretending the CLI is usable. We assert that correct rejection.
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-sc-badcli-'));
  const binDir = path.join(baseDir, 'bin');
  const logPath = path.join(baseDir, 'log');
  mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, 'nightvision');
  writeFileSync(stub, '#!/bin/sh\necho hi\n');
  chmodSync(stub, 0o644); // readable but NOT executable -> EACCES on exec

  const child = spawnServer(baseDir, binDir, logPath, { env: { NIGHTVISION_CLI_PATH: stub } });
  let stderr = '';
  child.stderr!.on('data', (d) => { stderr += d.toString(); });

  const exitCode: number | null = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
    setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 8000);
  });

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /NightVision CLI not found|not installed|install NightVision/i);
});
