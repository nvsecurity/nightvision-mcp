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

    // The assertion above compares tools/list against the same map that drives
    // registration, so dropping a tool and its metadata entry together would
    // pass. This fixture is written out independently: it is what the client
    // actually sees, and it fails on a dropped tool, an added tool, or a
    // silently reclassified one. Update it deliberately, never to make a test
    // go green.
    const EXPECTED_ANNOTATIONS: Record<string, Record<string, boolean>> = {
      'authenticate': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'create-header-credential': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'create-cookie-credential': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'assign-credential-to-targets': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'save-playwright-script': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'update-playwright-script': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'get-auth-credential': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'list-auth-credentials': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'login-help': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'doctor': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'auth-status': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'discover-api': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'export-sarif': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'export-csv': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'list-issues': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-issue-details': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-issue-kind-stats': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-vulnerable-paths': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-issue-occurrences': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'run-app-security-scan': { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      'create-nuclei-template': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'upload-nuclei-template': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'list-nuclei-templates': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'assign-nuclei-template': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'preflight-app': { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      'list-projects': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-project-details': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'start-scan': { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      'wait-for-scan': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'list-managed-scan-processes': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-managed-scan-process': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'cancel-managed-scan-process': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'list-scans': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-scan-status': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-scan-checks': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'summarize-scan-findings': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-scan-paths': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'list-check-categories': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'list-targets': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'get-target-details': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'create-target': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'delete-target': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      'find-target': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'list-additional-paths': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'add-additional-paths': { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      'record-traffic': { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      'list-traffic': { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      'download-traffic': { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    };

    assert.equal(
      tools.length,
      Object.keys(EXPECTED_ANNOTATIONS).length,
      `tools/list should expose ${Object.keys(EXPECTED_ANNOTATIONS).length} tools, got ${tools.length}`,
    );
    assert.deepEqual(
      Object.fromEntries(tools.map((tool: any) => [tool.name, tool.annotations])),
      EXPECTED_ANNOTATIONS,
      'every advertised tool carries its reviewed safety classification',
    );

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

      // A schema that degrades to an empty object still builds, lints, and
      // registers, but leaves the client with no idea what to pass. These two
      // tools genuinely take no parameters; everything else must advertise
      // some.
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} has no object inputSchema`);
      if (!['list-managed-scan-processes', 'list-check-categories'].includes(tool.name)) {
        assert.ok(
          Object.keys(tool.inputSchema.properties ?? {}).length > 0,
          `${tool.name} advertises an empty inputSchema, so callers cannot supply its parameters`,
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
    assert.deepEqual(
      toolByName('authenticate').annotations,
      {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      'authenticate replaces the stored token, and clears it outright when a supplied token is rejected',
    );
    assert.deepEqual(
      toolByName('doctor').annotations,
      {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      'doctor only inspects local setup and the NightVision API, never an arbitrary external host',
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
