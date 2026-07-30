import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repositoryRoot, 'plugins', 'nightvision');
// Read the version rather than restating it: the MCP package version is the
// single source that drives the plugin manifest and the packaged runtime.
const expectedVersion = JSON.parse(
  readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
).version;
const temporaryHome = mkdtempSync(join(tmpdir(), 'nightvision-plugin-smoke-'));
const fakeCli = join(temporaryHome, 'bin', 'nightvision');
mkdirSync(dirname(fakeCli), { recursive: true });
writeFileSync(
  fakeCli,
  '#!/bin/sh\nif [ "$1" = "version" ]; then printf "nightvision version 1.9.0\\n"; exit 0; fi\nprintf "{}\\n"\n',
);
chmodSync(fakeCli, 0o755);

const child = spawn('node', ['./build/core/server.mjs'], {
  cwd: pluginRoot,
  env: {
    ...process.env,
    HOME: temporaryHome,
    NIGHTVISION_CLI_PATH: fakeCli,
    NIGHTVISION_TOKEN: '',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdoutBuffer = '';
let stderr = '';
let nextRequestId = 1;
const pending = new Map();

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk;
  while (stdoutBuffer.includes('\n')) {
    const newline = stdoutBuffer.indexOf('\n');
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter.resolve(message);
    }
  }
});

function request(method, params = {}) {
  const id = nextRequestId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out waiting for ${method}\n${stderr}`));
    }, 10_000);
    pending.set(id, {
      resolve(message) {
        clearTimeout(timeout);
        resolveRequest(message);
      },
    });
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

try {
  const initialized = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {
      name: 'nightvision-plugin-smoke-test',
      version: '0.1.0',
    },
  });
  if (initialized.error) throw new Error(JSON.stringify(initialized.error));
  if (initialized.result?.serverInfo?.name !== 'NightVision Scanner') {
    throw new Error('MCP initialize returned an unexpected server name');
  }
  if (initialized.result?.serverInfo?.version !== expectedVersion) {
    throw new Error(
      `MCP initialize returned version ${initialized.result?.serverInfo?.version}`,
    );
  }

  notify('notifications/initialized');
  const listed = await request('tools/list');
  if (listed.error) throw new Error(JSON.stringify(listed.error));
  const tools = listed.result?.tools ?? [];
  if (tools.length !== 48) {
    throw new Error(`Expected 48 MCP tools, received ${tools.length}`);
  }

  const toolNames = new Set(tools.map((tool) => tool.name));
  for (const requiredTool of [
    'auth-status',
    'preflight-app',
    'run-app-security-scan',
    'wait-for-scan',
    'summarize-scan-findings',
    'export-sarif',
  ]) {
    if (!toolNames.has(requiredTool)) {
      throw new Error(`Required MCP tool is missing: ${requiredTool}`);
    }
  }

  for (const tool of tools) {
    if (!tool.description?.trim()) {
      throw new Error(`MCP tool is missing a description: ${tool.name}`);
    }
    if (!tool.title?.trim()) {
      throw new Error(`MCP tool is missing a title: ${tool.name}`);
    }
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
      if (typeof tool.annotations?.[hint] !== 'boolean') {
        throw new Error(`MCP tool is missing ${hint}: ${tool.name}`);
      }
    }
  }

  console.log('MCP smoke test passed.');
  console.log(`Server: ${initialized.result.serverInfo.name}@${initialized.result.serverInfo.version}`);
  console.log(`Tools: ${tools.length}`);
} finally {
  child.kill('SIGTERM');
  rmSync(temporaryHome, { recursive: true, force: true });
}
