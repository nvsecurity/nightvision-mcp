import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISABLE_NUCLEI_TEMPLATES_FLAG, helpListsFlag } from './cli-capabilities.js';

const OLD_HELP = `Flags:
      --disable-nuclei-folders strings            Nuclei Folder paths to disable (supports comma-separated list)
      --no-zap                                    Set this flag to disable ZAP alerts
`;
const NEW_HELP = `${OLD_HELP}      --disable-nuclei-templates strings          Custom Nuclei template UUIDs to disable (supports comma-separated list)
`;

test('helpListsFlag finds --disable-nuclei-templates only when the CLI lists it as a flag', () => {
  assert.equal(helpListsFlag(NEW_HELP, DISABLE_NUCLEI_TEMPLATES_FLAG), true);
  assert.equal(helpListsFlag(OLD_HELP, DISABLE_NUCLEI_TEMPLATES_FLAG), false);
  // A mention inside another flag's description is not the flag itself.
  assert.equal(helpListsFlag('      --x string   see --disable-nuclei-templates\n', DISABLE_NUCLEI_TEMPLATES_FLAG), false);
  // A longer flag that starts with the same text is a different flag.
  assert.equal(helpListsFlag('      --disable-nuclei-templates-all   x\n', DISABLE_NUCLEI_TEMPLATES_FLAG), false);
  assert.equal(helpListsFlag('  -c, --auth string   Authentication name\n', '--auth'), true);
});
