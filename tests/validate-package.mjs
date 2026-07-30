import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repositoryRoot, 'plugins', 'nightvision');
const errors = [];

function readJson(relativePath) {
  const absolutePath = join(repositoryRoot, relativePath);
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return {};
  }
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

const rootPackage = readJson('package.json');
const marketplace = readJson('.agents/plugins/marketplace.json');
const manifest = readJson('plugins/nightvision/.codex-plugin/plugin.json');
const mcp = readJson('plugins/nightvision/.mcp.json');
const runtimePackage = readJson('plugins/nightvision/package.json');
const buildInfo = readJson('plugins/nightvision/build-info.json');

check(rootPackage.version === manifest.version, 'root and plugin versions must match');
check(manifest.name === 'nightvision', 'plugin name must be nightvision');
check(manifest.skills === './skills/', 'manifest must expose ./skills/');
check(manifest.mcpServers === './.mcp.json', 'manifest must expose ./.mcp.json');
check(
  /^(0|[1-9]\d*)\.\d+\.\d+$/.test(manifest.version),
  'plugin version must be semver',
);

const interfaceMetadata = manifest.interface ?? {};
for (const key of [
  'displayName',
  'shortDescription',
  'longDescription',
  'developerName',
  'category',
]) {
  check(
    typeof interfaceMetadata[key] === 'string' && interfaceMetadata[key].trim(),
    `interface.${key} must be a non-empty string`,
  );
}

for (const key of ['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
  check(
    typeof interfaceMetadata[key] === 'string' &&
      interfaceMetadata[key].startsWith('https://'),
    `interface.${key} must be an HTTPS URL`,
  );
}

check(
  Array.isArray(interfaceMetadata.defaultPrompt) &&
    interfaceMetadata.defaultPrompt.length > 0 &&
    interfaceMetadata.defaultPrompt.length <= 3,
  'interface.defaultPrompt must contain one to three prompts',
);
for (const prompt of interfaceMetadata.defaultPrompt ?? []) {
  check(
    typeof prompt === 'string' && prompt.length <= 128,
    'each default prompt must be at most 128 characters',
  );
}

for (const key of ['composerIcon', 'logo', 'logoDark']) {
  const assetPath = interfaceMetadata[key];
  check(
    typeof assetPath === 'string' &&
      assetPath.startsWith('./assets/') &&
      existsSync(join(pluginRoot, assetPath)),
    `interface.${key} must resolve to a packaged asset`,
  );
}

check(marketplace.name === 'nightvision', 'marketplace name must be nightvision');
check(marketplace.plugins?.length === 1, 'marketplace must contain one plugin');
const marketplacePlugin = marketplace.plugins?.[0] ?? {};
check(marketplacePlugin.name === manifest.name, 'marketplace and manifest names must match');
check(
  marketplacePlugin.source?.source === 'local' &&
    marketplacePlugin.source?.path === './plugins/nightvision',
  'marketplace source must point to the packaged local plugin',
);
check(
  ['AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(
    marketplacePlugin.policy?.installation,
  ),
  'marketplace installation policy is invalid',
);
check(
  ['ON_INSTALL', 'ON_USE'].includes(marketplacePlugin.policy?.authentication),
  'marketplace authentication policy is invalid',
);

const server = mcp.mcpServers?.nightvision;
check(server?.command === 'node', 'MCP server must run with node');
check(
  JSON.stringify(server?.args) === JSON.stringify(['./build/core/server.mjs']),
  'MCP server must run the packaged bundle',
);
check(server?.cwd === '.', 'MCP server cwd must be the plugin root');
check(
  !JSON.stringify(mcp).includes(repositoryRoot),
  'MCP config must not contain machine-specific paths',
);

// One version source. The MCP package version drives the plugin manifest,
// the packaged runtime, and the build info, so none of them can drift.
check(
  runtimePackage.version === rootPackage.version,
  'packaged runtime version must match the MCP package version',
);
check(
  buildInfo.version === rootPackage.version,
  'build info version must match the MCP package version',
);
check(
  buildInfo.entrypoint === 'src/index.ts',
  'the bundle must be built from this repository\'s MCP entrypoint',
);
check(/^[0-9a-f]{64}$/.test(buildInfo.sha256), 'bundle SHA-256 is invalid');

const bundlePath = join(pluginRoot, buildInfo.bundle ?? '');
check(existsSync(bundlePath), 'MCP bundle is missing');
if (existsSync(bundlePath)) {
  const actualHash = createHash('sha256')
    .update(readFileSync(bundlePath))
    .digest('hex');
  check(actualHash === buildInfo.sha256, 'MCP bundle checksum does not match build info');
}
check(
  existsSync(join(pluginRoot, 'THIRD_PARTY_LICENSES.txt')),
  'third-party license report is missing',
);
check(
  existsSync(join(pluginRoot, 'skills', 'LICENSE')),
  'Apache-2.0 license for copied skills is missing',
);

const expectedSkills = [
  'api-discovery',
  'app-security-scan',
  'ci-cd-integration',
  'scan-configuration',
  'scan-triage',
];
const actualSkills = readdirSync(join(pluginRoot, 'skills'))
  .filter((entry) => existsSync(join(pluginRoot, 'skills', entry, 'SKILL.md')))
  .sort();
check(
  JSON.stringify(actualSkills) === JSON.stringify(expectedSkills),
  `expected skills ${expectedSkills.join(', ')}, found ${actualSkills.join(', ')}`,
);

for (const skillName of expectedSkills) {
  const contents = readFileSync(
    join(pluginRoot, 'skills', skillName, 'SKILL.md'),
    'utf8',
  );
  check(contents.startsWith('---\n'), `${skillName} must have YAML frontmatter`);
  check(
    new RegExp(`^name:\\s*${skillName}$`, 'm').test(contents),
    `${skillName} frontmatter name is missing or incorrect`,
  );
  check(
    /^description:\s*\S.+$/m.test(contents),
    `${skillName} frontmatter description is missing`,
  );
}

const textFiles = [
  'README.md',
  'SECURITY.md',
  '.agents/plugins/marketplace.json',
  'plugins/nightvision/.codex-plugin/plugin.json',
  'plugins/nightvision/.mcp.json',
];
for (const file of textFiles) {
  const contents = readFileSync(join(repositoryRoot, file), 'utf8');
  check(!contents.includes('[TODO:'), `${file} contains a TODO placeholder`);
}

if (errors.length > 0) {
  console.error('Package validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Package validation passed.');
console.log(`Plugin: ${manifest.name}@${manifest.version}`);
console.log(`Skills: ${actualSkills.length}`);
console.log(`MCP bundle: ${buildInfo.version} built from ${buildInfo.entrypoint}`);
