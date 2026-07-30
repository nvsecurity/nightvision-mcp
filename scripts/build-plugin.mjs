// Bundles this repository's MCP server into the Codex plugin directory.
//
// Source and artifact now live in one repository, so there is no cross-repo
// commit pin to verify. Freshness is guaranteed instead by CI: it rebuilds and
// runs `git diff --exit-code`, which fails if the checked-in bundle does not
// match the current src/. Deliberately records no commit SHA — the bundle is
// committed in the same commit that would name it, and a SHA that changed per
// build would make that CI diff fail spuriously.

import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repositoryRoot, 'plugins', 'nightvision');
const buildInfoPath = join(pluginRoot, 'build-info.json');
const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result.stdout.trim();
}

// One version source: the MCP package version drives the plugin manifest and
// the packaged runtime, so the two cannot drift.
const version = packageJson.version;
buildInfo.version = version;

const tempRoot = mkdtempSync(join(tmpdir(), 'nightvision-plugin-build-'));
const metafilePath = join(tempRoot, 'metafile.json');
const bundlePath = join(pluginRoot, buildInfo.bundle);
const esbuildBinary = process.env.NIGHTVISION_ESBUILD_BIN;
const esbuildArgs = [
  join(repositoryRoot, buildInfo.entrypoint),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  '--banner:js=import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  `--outfile=${bundlePath}`,
  `--metafile=${metafilePath}`,
];

try {
  if (esbuildBinary) {
    run(esbuildBinary, esbuildArgs, { cwd: repositoryRoot });
  } else {
    run(
      'npx',
      ['--yes', `esbuild@${buildInfo.builder.split('@').at(-1)}`, ...esbuildArgs],
      { cwd: repositoryRoot },
    );
  }

  const metafile = JSON.parse(readFileSync(metafilePath, 'utf8'));
  const dependencyRoots = new Map();

  // Split on the platform separator: resolve() emits backslashes on Windows,
  // so a hardcoded "node_modules/" marker would match nothing there and
  // silently produce an empty license report.
  const marker = `node_modules${sep}`;
  for (const inputPath of Object.keys(metafile.inputs)) {
    const absoluteInput = resolve(repositoryRoot, inputPath);
    const markerIndex = absoluteInput.lastIndexOf(marker);
    if (markerIndex === -1) continue;

    const moduleRoot = absoluteInput.slice(0, markerIndex + marker.length);
    const remainder = absoluteInput.slice(markerIndex + marker.length);
    const parts = remainder.split(sep);
    const packageName = parts[0].startsWith('@')
      ? parts.slice(0, 2).join('/')
      : parts[0];
    dependencyRoots.set(packageName, join(moduleRoot, packageName));
  }

  if (dependencyRoots.size === 0) {
    throw new Error(
      'No bundled dependencies were detected. Refusing to write an empty license report.',
    );
  }

  const notices = [
    '# Third-party licenses',
    '',
    `Generated from the NightVision MCP server in this repository, version ${version}.`,
    '',
  ];

  for (const [packageName, packageRoot] of [...dependencyRoots].sort()) {
    const dependencyPackage = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    );
    const licenseFiles = readdirSync(packageRoot)
      .filter((name) => /^(license|licence|copying|notice)(\.|$)/i.test(name))
      .filter((name) => statSync(join(packageRoot, name)).isFile())
      .sort();

    notices.push('='.repeat(78));
    notices.push(
      `${packageName}@${dependencyPackage.version} (${dependencyPackage.license ?? 'license file'})`,
    );
    notices.push('='.repeat(78));
    notices.push('');

    if (licenseFiles.length === 0) {
      notices.push('No standalone license file was present in the installed package.');
      notices.push('');
      continue;
    }

    for (const licenseFile of licenseFiles) {
      notices.push(`--- ${licenseFile} ---`);
      notices.push('');
      notices.push(readFileSync(join(packageRoot, licenseFile), 'utf8').trim());
      notices.push('');
    }
  }

  writeFileSync(
    join(pluginRoot, 'THIRD_PARTY_LICENSES.txt'),
    `${notices.join('\n').trimEnd()}\n`,
  );

  const digest = createHash('sha256')
    .update(readFileSync(bundlePath))
    .digest('hex');
  buildInfo.sha256 = digest;
  writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`);

  // Keep the packaged runtime manifest and the plugin manifest on the one
  // version rather than letting either be edited independently.
  for (const manifestPath of [
    join(pluginRoot, 'package.json'),
    join(pluginRoot, '.codex-plugin', 'plugin.json'),
  ]) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`Built ${buildInfo.bundle}`);
  console.log(`Version: ${version}`);
  console.log(`SHA-256: ${digest}`);
  console.log(`Bundled dependencies: ${dependencyRoots.size}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
