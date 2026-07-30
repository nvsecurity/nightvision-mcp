import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NIGHTVISION_TOOL_METADATA } from './tools/metadata.js';

// The compiled test sits next to the compiled entry point in build/.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'index.js');

// Minimal newline-delimited JSON-RPC client over the child's stdio.
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
        // Ignore non-JSON lines (the server also logs to stderr, not stdout).
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

test('server boots, advertises the tools capability, and lists the tool set', {
  timeout: 30000,
  skip: process.platform === 'win32' ? 'requires a POSIX shell stub' : false
}, async () => {
  // A fake `nightvision` on PATH so the startup install check passes without the
  // real CLI, and a throwaway HOME so no saved token triggers a network call.
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-smoke-'));
  const binDir = path.join(baseDir, 'bin');
  const homeDir = path.join(baseDir, 'home');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  const stub = path.join(binDir, 'nightvision');
  writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  chmodSync(stub, 0o755);

  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      HOME: homeDir,
      NIGHTVISION_TOKEN: ''
    }
  });

  try {
    const client = createClient(child);

    const init = await client.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '0.0.0' }
    });
    assert.ok(init.result?.serverInfo?.name, 'serverInfo.name is present');
    assert.ok(init.result?.capabilities?.tools, 'tools capability is advertised');

    // The advertised version is sourced from package.json (single source of
    // truth), so the handshake must report exactly the package version.
    const pkgVersion = JSON.parse(
      readFileSync(path.join(here, '..', 'package.json'), 'utf8')
    ).version;
    assert.equal(
      init.result?.serverInfo?.version,
      pkgVersion,
      'serverInfo.version matches package.json'
    );

    client.notify('notifications/initialized');

    const listed = await client.rpc('tools/list', {});
    const tools = listed.result?.tools ?? [];
    const names: string[] = tools.map((t: any) => t.name);

    assert.deepEqual(
      [...names].sort(),
      Object.keys(NIGHTVISION_TOOL_METADATA).sort(),
      'tools/list exposes the complete reviewed NightVision tool set',
    );

    // A representative slice of the registered tools must be present.
    for (const expected of [
      'authenticate', 'list-targets', 'get-target-details', 'create-target',
      'delete-target', 'start-scan', 'list-scans', 'get-scan-checks',
      'discover-api', 'list-projects', 'upload-nuclei-template',
      'record-traffic', 'download-traffic', 'wait-for-scan',
      'summarize-scan-findings', 'export-sarif', 'export-csv',
      'preflight-app', 'run-app-security-scan', 'doctor', 'auth-status',
      'login-help',
      'list-managed-scan-processes', 'get-managed-scan-process',
      'cancel-managed-scan-process'
    ]) {
      assert.ok(names.includes(expected), `tools/list is missing "${expected}" (got ${names.length} tools)`);
    }

    // OpenAI plugin review relies on complete, accurate metadata for tool
    // selection and confirmation behavior. Every tool must advertise a title,
    // description, and all three core MCP safety hints.
    for (const tool of tools) {
      assert.equal(typeof tool.title, 'string', `${tool.name} is missing a title`);
      assert.ok(tool.title.trim().length > 0, `${tool.name} has an empty title`);
      assert.equal(typeof tool.description, 'string', `${tool.name} is missing a description`);
      assert.ok(tool.description.trim().length > 0, `${tool.name} has an empty description`);
      for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const) {
        assert.equal(
          typeof tool.annotations?.[hint],
          'boolean',
          `${tool.name} is missing boolean annotation ${hint}`,
        );
      }
    }

    const toolByName = (name: string) => {
      const tool = tools.find((candidate: any) => candidate.name === name);
      assert.ok(tool, `tools/list is missing "${name}"`);
      return tool;
    };

    assert.deepEqual(
      toolByName('list-projects').annotations,
      {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      'list-projects is a repeatable read confined to the user account',
    );
    assert.deepEqual(
      toolByName('start-scan').annotations,
      {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      'start-scan actively affects an external target',
    );
    assert.deepEqual(
      toolByName('delete-target').annotations,
      {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      'delete-target irreversibly changes NightVision account state',
    );
    assert.deepEqual(
      toolByName('preflight-app').annotations,
      {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
      'preflight-app writes a local manifest and reaches the supplied target URL',
    );

    // zod -> JSON Schema shape checks on a couple of tools.
    const gtd = tools.find((t: any) => t.name === 'get-target-details');
    assert.equal(gtd.inputSchema.properties.project_id.format, 'uuid', 'project_id renders as a uuid');
    assert.ok(gtd.inputSchema.required.includes('name'), 'get-target-details requires name');

    const checks = tools.find((t: any) => t.name === 'get-scan-checks');
    const checksRequired = checks.inputSchema.required ?? [];
    assert.ok(checksRequired.includes('scan_id'), 'get-scan-checks requires scan_id');
    assert.equal(checksRequired.includes('severity'), false, 'get-scan-checks severity defaults for agent use');
    assert.equal(checksRequired.includes('status'), false, 'get-scan-checks status defaults for agent use');
  } finally {
    child.kill('SIGKILL');
  }
});
