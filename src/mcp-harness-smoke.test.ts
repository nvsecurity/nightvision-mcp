import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'index.js');

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
  const rpc = (method: string, params: any, timeoutMs = 10000): Promise<any> =>
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

function fakeNightVision(baseDir: string): { binDir: string; logPath: string } {
  const binDir = path.join(baseDir, 'bin');
  const logPath = path.join(baseDir, 'nightvision-args.log');
  mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, 'nightvision');
  writeFileSync(stub, [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    'exit 0',
    ''
  ].join('\n'));
  chmodSync(stub, 0o755);
  return { binDir, logPath };
}

function fakeNightVisionForHarness(baseDir: string): { binDir: string; logPath: string } {
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
    'const targetExistsMarker = `${process.env.NIGHTVISION_TEST_LOG}.target-exists`;',
    'function argAfter(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }',
    'function json(value) { process.stdout.write(`${JSON.stringify(value)}\\n`); }',
    'if (args[0] === "--help") { process.stdout.write("NightVision help\\n"); process.exit(0); }',
    'if (args[0] === "version") { process.stdout.write("NightVision CLI 0.12.3\\n"); process.exit(0); }',
    'if (args[0] === "project" && args[1] === "list") { json({ results: [{ id: "project-1", name: "Demo Project", is_default: true }] }); process.exit(0); }',
    'if (args[0] === "swagger" && args[1] === "extract") {',
    '  const output = argAfter("--output") || argAfter("-o");',
    '  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, "openapi: 3.0.0\\ninfo:\\n  title: Fixture API\\n  version: 1.0.0\\npaths:\\n  /health:\\n    get:\\n      responses:\\n        \\"200\\":\\n          description: ok\\n"); }',
    '  process.stdout.write("Swagger file extracted successfully.\\n");',
    '  process.exit(0);',
    '}',
    'if (args[0] === "target" && args[1] === "list") { json([]); process.exit(0); }',
    'if (args[0] === "target" && args[1] === "create" && process.env.NIGHTVISION_TEST_TARGET_EXISTS_AFTER_CREATE === "1") {',
    '  fs.writeFileSync(targetExistsMarker, args[2]);',
    '  console.error(`name: Target with the name "${args[2]}" already exists in the Project.`);',
    '  process.exit(1);',
    '}',
    'if (args[0] === "target" && (args[1] === "create" || args[1] === "update")) {',
    '  const name = args[2];',
    '  const location = args[1] === "create" ? args[3] : argAfter("-u");',
    '  json({ id: "target-1", name, location, project_name: "Demo Project", project: "project-1", project_id: "project-1", type: argAfter("-t") || "API", is_ready_to_scan: true });',
    '  process.exit(0);',
    '}',
    'if (args[0] === "scan") { json({ id: "scan-123", target_name: args[1] }); process.exit(0); }',
    'if (args[0] === "export") {',
    '  const output = argAfter("--output");',
    '  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, args[1] === "sarif" ? "{\\"version\\":\\"2.1.0\\",\\"runs\\":[]}" : "id,severity\\n"); }',
    '  json({ ok: true, output });',
    '  process.exit(0);',
    '}',
    'json({ ok: true });',
    ''
  ].join('\n'));
  chmodSync(stub, 0o755);
  return { binDir, logPath };
}

async function startLocalApp(): Promise<{ server: Server; url: string } | null> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error: any) {
    if (error?.code === 'EPERM') {
      return null;
    }
    throw error;
  }
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function startFakeNightVisionApi(options: { targetExistsMarker?: string } = {}): Promise<{ server: Server; url: string } | null> {
  const server = createServer((req, res) => {
    const requestUrl = req.url || '';
    res.setHeader('content-type', 'application/json');

    if (requestUrl.startsWith('/api/v1/user/me/')) {
      res.end(JSON.stringify({
        user: {
          id: 'user-1',
          email: 'demo@example.com',
          name: 'Demo User'
        },
        organization: { id: 'org-1', name: 'Demo Org' },
        roles: ['developer']
      }));
      return;
    }

    if (requestUrl.startsWith('/api/v1/projects/name/Demo%20Project/')) {
      res.end(JSON.stringify({
        results: [{ id: 'project-1', name: 'Demo Project', is_default: true }]
      }));
      return;
    }

    if (requestUrl.startsWith('/api/v1/targets/')) {
      const shouldReturnExistingTarget = options.targetExistsMarker
        ? existsSync(options.targetExistsMarker)
        : false;
      const targetName = shouldReturnExistingTarget && options.targetExistsMarker
        ? readFileSync(options.targetExistsMarker, 'utf8')
        : 'existing-target';
      res.end(JSON.stringify({
        results: shouldReturnExistingTarget ? [{
          id: 'target-1',
          name: targetName,
          project_name: 'Demo Project',
          project: 'project-1',
          project_id: 'project-1',
          location: 'http://127.0.0.1:3000',
          type: 'OPENAPI'
        }] : []
      }));
      return;
    }

    if (requestUrl.startsWith('/api/v1/scans/scan-123/checks/')) {
      res.end(JSON.stringify({ results: [], count: 0 }));
      return;
    }

    if (requestUrl.startsWith('/api/v1/scans/scan-123/')) {
      res.end(JSON.stringify({
        id: 'scan-123',
        status: 'SUCCEEDED',
        status_value: 1,
        target: { id: 'target-1', name: 'express-api' },
        project: { id: 'project-1', name: 'Demo Project' },
        progress: 100
      }));
      return;
    }

    if (requestUrl.startsWith('/api/v1/scans/')) {
      res.end(JSON.stringify({ results: [] }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ detail: `Unhandled fake API path: ${requestUrl}` }));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error: any) {
    if (error?.code === 'EPERM') {
      return null;
    }
    throw error;
  }

  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/api/v1/` };
}

// Copy the checked-in fixture app into a throwaway temp dir so the harness can
// write .nightvision/ artifacts (manifest, openapi, sarif) during the test
// WITHOUT dirtying the repo or leaking local absolute paths into version control.
function copyFixtureApp(baseDir: string): string {
  const src = path.resolve('fixtures/demo-apps/express-api');
  const dest = path.join(baseDir, 'express-api');
  cpSync(src, dest, { recursive: true });
  return dest;
}

function createExpressProject(baseDir: string): string {
  const projectPath = path.join(baseDir, 'express-demo');
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({
    dependencies: { express: '^4.18.0' }
  }, null, 2));
  writeFileSync(path.join(projectPath, 'index.js'), [
    "const express = require('express');",
    'const app = express();',
    "app.get('/api/health', (_req, res) => res.json({ ok: true }));",
    ''
  ].join('\n'));
  return projectPath;
}

function spawnMcpServer(
  baseDir: string,
  binDir: string,
  logPath: string,
  options: { token?: string; apiUrl?: string; extraEnv?: Record<string, string> } = {}
): ChildProcess {
  const homeDir = path.join(baseDir, 'home');
  mkdirSync(homeDir, { recursive: true });
  if (options.token) {
    const nvDir = path.join(homeDir, '.nightvision');
    mkdirSync(nvDir, { recursive: true });
    writeFileSync(path.join(nvDir, 'token'), options.token);
  }
  return spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      HOME: homeDir,
      NIGHTVISION_TOKEN: '',
      NIGHTVISION_TEST_LOG: logPath,
      ...(options.extraEnv || {}),
      ...(options.apiUrl ? { NIGHTVISION_API_URL: options.apiUrl } : {})
    }
  });
}

async function initialize(child: ChildProcess) {
  const client = createClient(child);
  await client.rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'harness-smoke-test', version: '0.0.0' }
  });
  client.notify('notifications/initialized');
  return client;
}

async function callTool(client: Awaited<ReturnType<typeof initialize>>, name: string, args: Record<string, unknown>) {
  const response = await client.rpc('tools/call', { name, arguments: args }, 30000);
  const text = response.result?.content?.[0]?.text;
  assert.equal(typeof text, 'string', `${name} should return text content`);
  return JSON.parse(text);
}

async function callToolText(client: Awaited<ReturnType<typeof initialize>>, name: string, args: Record<string, unknown>) {
  const response = await client.rpc('tools/call', { name, arguments: args }, 30000);
  const text = response.result?.content?.[0]?.text;
  assert.equal(typeof text, 'string', `${name} should return text content`);
  return { text, isError: !!response.result?.isError };
}

test('preflight-app detects local app readiness and writes a manifest without auth', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async (t) => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-preflight-smoke-'));
  const { binDir, logPath } = fakeNightVision(baseDir);
  const projectPath = createExpressProject(baseDir);
  const app = await startLocalApp();
  if (!app) {
    t.skip('local loopback listen is blocked in this sandbox');
    return;
  }
  const child = spawnMcpServer(baseDir, binDir, logPath);

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'preflight-app', {
      project_path: projectPath,
      target_url: app.url,
      project_name: 'Demo Project'
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'partial');
    assert.deepEqual(payload.data.app.languages, ['js']);
    assert.deepEqual(payload.data.app.frameworks, ['express']);
    assert.equal(payload.data.app.target_url, app.url);
    assert.equal(payload.data.app.checked_urls[0].reachable, true);
    assert.equal(payload.data.nightvision.project_name, 'Demo Project');
    assert.ok(payload.data.blockers.includes('not_authenticated'));
    assert.ok(payload.data.manifest_path.endsWith('.nightvision/manifest.json'));
    assert.equal(existsSync(payload.data.manifest_path), true);

    const manifest = JSON.parse(readFileSync(payload.data.manifest_path, 'utf8'));
    assert.equal(manifest.workflow, 'preflight-app');
    assert.equal(manifest.app.target_url, app.url);
    assert.ok(manifest.blockers.includes('not_authenticated'));
  } finally {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  }
});

test('preflight-app reports a stopped or unreachable app as a concrete blocker', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-preflight-blocked-'));
  const { binDir, logPath } = fakeNightVision(baseDir);
  const projectPath = createExpressProject(baseDir);
  const child = spawnMcpServer(baseDir, binDir, logPath);

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'preflight-app', {
      project_path: projectPath,
      target_url: 'http://127.0.0.1:1',
      project_name: 'Demo Project',
      timeout_seconds: 1
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'partial');
    assert.equal(payload.data.app.target_url, null);
    assert.ok(payload.data.blockers.includes('not_authenticated'));
    assert.ok(payload.data.blockers.includes('runtime_url_not_reachable'));
    assert.equal(existsSync(payload.data.manifest_path), true);

    const manifest = JSON.parse(readFileSync(payload.data.manifest_path, 'utf8'));
    assert.equal(manifest.workflow, 'preflight-app');
    assert.ok(manifest.blockers.includes('runtime_url_not_reachable'));
  } finally {
    child.kill('SIGKILL');
  }
});

test('doctor and auth-status provide setup blockers without requiring API validation', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-doctor-smoke-'));
  const { binDir, logPath } = fakeNightVision(baseDir);
  const child = spawnMcpServer(baseDir, binDir, logPath);

  try {
    const client = await initialize(child);
    const doctor = await callTool(client, 'doctor', { validate_auth: false });
    assert.equal(doctor.ok, false);
    assert.equal(doctor.status, 'blocked');
    assert.equal(doctor.error.details.cli.installed, true);
    assert.ok(doctor.blockers.includes('not_authenticated'));
    assert.ok(doctor.error.details.next_steps.some((step: string) => step.includes('nightvision login')));

    const authStatus = await callTool(client, 'auth-status', { validate: false });
    assert.equal(authStatus.ok, false);
    assert.equal(authStatus.status, 'blocked');
    assert.equal(authStatus.error.details.token_present, false);
    assert.ok(authStatus.blockers.includes('not_authenticated'));

    const loginHelp = await callTool(client, 'login-help', {});
    assert.equal(loginHelp.ok, true);
    assert.match(loginHelp.data.login_command, /nightvision login/);
  } finally {
    child.kill('SIGKILL');
  }
});

test('low-level auth tools block expiring header or cookie credentials', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-auth-policy-smoke-'));
  const { binDir, logPath } = fakeNightVision(baseDir);
  const child = spawnMcpServer(baseDir, binDir, logPath);

  try {
    const client = await initialize(child);
    const header = await callToolText(client, 'create-header-credential', {
      name: 'session-token',
      headers: [{ name: 'Authorization', value: 'Bearer short-lived' }],
      project: 'project-1',
      credential_lifetime: 'session'
    });
    assert.equal(header.isError, true);
    assert.match(header.text, /stable non-expiring/);
    assert.match(header.text, /Playwright script auth/);

    const cookie = await callToolText(client, 'create-cookie-credential', {
      name: 'session-cookie',
      cookies: [{ name: 'session', value: 'short-lived' }],
      project: 'project-1'
    });
    assert.equal(cookie.isError, true);
    assert.match(cookie.text, /stable non-expiring/);
    assert.match(cookie.text, /Playwright script auth/);
  } finally {
    child.kill('SIGKILL');
  }
});

test('run-app-security-scan dry run reports readiness without starting DAST actions', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async (t) => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-harness-dry-run-'));
  const { binDir, logPath } = fakeNightVision(baseDir);
  const projectPath = createExpressProject(baseDir);
  const app = await startLocalApp();
  if (!app) {
    t.skip('local loopback listen is blocked in this sandbox');
    return;
  }
  const child = spawnMcpServer(baseDir, binDir, logPath);

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'run-app-security-scan', {
      project_path: projectPath,
      target_url: app.url,
      nightvision_project: 'Demo Project',
      dry_run: true
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'partial');
    assert.equal(payload.data.dry_run, true);
    assert.deepEqual(payload.data.app.languages, ['js']);
    assert.deepEqual(payload.data.app.frameworks, ['express']);
    assert.equal(payload.data.app.target_url, app.url);
    assert.ok(payload.data.blockers.includes('not_authenticated'));
    assert.equal(payload.data.nightvision.app_auth.no_auth, true);
    assert.ok(payload.warnings.some((warning: string) => warning.includes('unauthenticated')));

    const manifest = JSON.parse(readFileSync(payload.data.manifest_path, 'utf8'));
    assert.equal(manifest.workflow, 'run-app-security-scan');
    assert.equal(manifest.dry_run, true);
    assert.equal(manifest.app.target_url, app.url);

    const cliCalls = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean);
    assert.ok(
      cliCalls.every((line) => line === '--help' || line.startsWith('version')),
      `dry run should only call CLI setup checks: ${cliCalls.join(' | ')}`
    );
  } finally {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  }
});

test('run-app-security-scan starts a mocked authenticated scan without waiting by default', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async (t) => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-harness-happy-'));
  const { binDir, logPath } = fakeNightVisionForHarness(baseDir);
  const projectPath = copyFixtureApp(baseDir);
  const app = await startLocalApp();
  if (!app) {
    t.skip('local loopback listen is blocked in this sandbox');
    return;
  }
  const api = await startFakeNightVisionApi();
  if (!api) {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    t.skip('local loopback listen is blocked in this sandbox');
    return;
  }
  const child = spawnMcpServer(baseDir, binDir, logPath, {
    token: 'test-token',
    apiUrl: api.url
  });

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'run-app-security-scan', {
      project_path: projectPath,
      target_url: app.url,
      nightvision_project: 'Demo Project',
      no_auth: true
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'running');
    assert.equal(payload.data.nightvision.authenticated, true);
    assert.equal(payload.data.nightvision.user.email, 'demo@example.com');
    assert.equal(payload.data.api_discovery.status, 'success');
    assert.equal(payload.data.target.action, 'created');
    assert.equal(payload.data.scan.scan_id, 'scan-123');
    assert.equal(payload.data.scan.status, 'started');
    assert.equal(existsSync(payload.data.manifest_path), true);

    const manifest = JSON.parse(readFileSync(payload.data.manifest_path, 'utf8'));
    assert.equal(manifest.scan.scan_id, 'scan-123');
    assert.equal(manifest.scan.status, 'started');
    assert.equal(manifest.nightvision.user.email, 'demo@example.com');

    const cliCalls = readFileSync(logPath, 'utf8');
    assert.match(cliCalls, /swagger extract/);
    assert.match(cliCalls, /target list/);
    assert.match(cliCalls, /target create/);
    assert.match(cliCalls, /scan /);
    assert.doesNotMatch(cliCalls, /export sarif/);
  } finally {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
  }
});

test('run-app-security-scan reuses an existing target when create reports already exists', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async (t) => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-harness-existing-target-'));
  const { binDir, logPath } = fakeNightVisionForHarness(baseDir);
  const projectPath = copyFixtureApp(baseDir);
  const app = await startLocalApp();
  if (!app) {
    t.skip('local loopback listen is blocked in this sandbox');
    return;
  }
  const targetExistsMarker = `${logPath}.target-exists`;
  const api = await startFakeNightVisionApi({ targetExistsMarker });
  if (!api) {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    t.skip('local loopback listen is blocked in this sandbox');
    return;
  }
  const child = spawnMcpServer(baseDir, binDir, logPath, {
    token: 'test-token',
    apiUrl: api.url,
    extraEnv: {
      NIGHTVISION_TEST_TARGET_EXISTS_AFTER_CREATE: '1'
    }
  });

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'run-app-security-scan', {
      project_path: projectPath,
      target_url: app.url,
      nightvision_project: 'Demo Project',
      no_auth: true,
      wait: true,
      timeout_seconds: 5
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.data.target.action, 'updated');
    assert.equal(payload.data.scan.scan_id, 'scan-123');
    assert.ok(payload.warnings.some((warning: string) => warning.includes('already exists')));

    const cliCalls = readFileSync(logPath, 'utf8');
    assert.match(cliCalls, /target create/);
    assert.match(cliCalls, /target update/);
    assert.match(cliCalls, /scan /);
    assert.match(cliCalls, /export sarif/);
  } finally {
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await new Promise<void>((resolve) => api.server.close(() => resolve()));
  }
});

test('run-app-security-scan blocks non-dry-run actions until auth and runtime blockers are fixed', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-harness-blocked-'));
  const { binDir, logPath } = fakeNightVision(baseDir);
  const projectPath = createExpressProject(baseDir);
  const child = spawnMcpServer(baseDir, binDir, logPath);

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'run-app-security-scan', {
      project_path: projectPath,
      target_url: 'http://127.0.0.1:1',
      nightvision_project: 'Demo Project',
      no_auth: true
    });

    assert.equal(payload.ok, false);
    assert.equal(payload.status, 'blocked');
    assert.equal(payload.error.code, 'APP_SCAN_PREFLIGHT_BLOCKED');
    assert.ok(payload.blockers.includes('not_authenticated'));
    assert.ok(payload.blockers.includes('runtime_url_not_reachable'));

    const manifestPath = payload.error.details.manifest_path;
    assert.equal(existsSync(manifestPath), true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.workflow, 'run-app-security-scan');
    assert.equal(manifest.dry_run, false);
    assert.ok(manifest.blockers.includes('not_authenticated'));
    assert.ok(manifest.blockers.includes('runtime_url_not_reachable'));

    const cliCalls = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean);
    assert.ok(
      cliCalls.every((line) => line === '--help' || line.startsWith('version')),
      `blocked run should only call CLI setup checks: ${cliCalls.join(' | ')}`
    );
  } finally {
    child.kill('SIGKILL');
  }
});

test('run-app-security-scan dry run records planned target app auth without creating it', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-harness-auth-plan-'));
  const { binDir, logPath } = fakeNightVision(baseDir);
  const projectPath = createExpressProject(baseDir);
  const child = spawnMcpServer(baseDir, binDir, logPath);

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'run-app-security-scan', {
      project_path: projectPath,
      target_url: 'http://127.0.0.1:1',
      nightvision_project: 'Demo Project',
      dry_run: true,
      app_auth: {
        type: 'headers',
        name: 'demo-api-auth',
        credential_lifetime: 'stable',
        headers: [
          { name: 'Authorization', value: 'Bearer secret-token' }
        ]
      }
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'partial');
    assert.equal(payload.data.nightvision.app_auth.no_auth, false);
    assert.deepEqual(payload.data.nightvision.app_auth.create, {
      type: 'headers',
      name: 'demo-api-auth',
      credential_lifetime: 'stable',
      planned: true
    });

    const manifestText = readFileSync(payload.data.manifest_path, 'utf8');
    assert.doesNotMatch(manifestText, /secret-token/);
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.nightvision.app_auth.create.name, 'demo-api-auth');

    const cliCalls = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean);
    assert.ok(
      cliCalls.every((line) => line === '--help' || line.startsWith('version')),
      `dry run should not create target app auth: ${cliCalls.join(' | ')}`
    );
  } finally {
    child.kill('SIGKILL');
  }
});

test('run-app-security-scan blocks expiring header or cookie auth and asks for Playwright auth', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-harness-expiring-auth-'));
  const { binDir } = fakeNightVision(baseDir);
  const projectPath = createExpressProject(baseDir);
  const child = spawnMcpServer(baseDir, binDir, path.join(baseDir, 'nightvision-args.log'));

  try {
    const client = await initialize(child);
    const payload = await callTool(client, 'run-app-security-scan', {
      project_path: projectPath,
      target_url: 'http://127.0.0.1:1',
      nightvision_project: 'Demo Project',
      dry_run: true,
      app_auth: {
        type: 'cookies',
        name: 'session-cookie-auth',
        credential_lifetime: 'session',
        cookies: [
          { name: 'session', value: 'short-lived-cookie' }
        ]
      }
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.status, 'partial');
    assert.ok(payload.data.blockers.includes('target_app_auth_requires_stable_credential'));
    assert.ok(payload.warnings.some((warning: string) => warning.includes('playwright_script')));

    const manifestText = readFileSync(payload.data.manifest_path, 'utf8');
    assert.doesNotMatch(manifestText, /short-lived-cookie/);
  } finally {
    child.kill('SIGKILL');
  }
});
