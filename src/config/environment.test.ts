import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// ENVIRONMENT is resolved once at import time, so each case loads the module
// in a fresh Node process with the environment under test.
function currentApiUrl(apiUrl: string | undefined): string {
  const env = { ...process.env };
  delete env.NIGHTVISION_API_URL;
  if (apiUrl !== undefined) env.NIGHTVISION_API_URL = apiUrl;
  const moduleUrl = new URL('./environment.js', import.meta.url).href;
  const script = `const m = await import(${JSON.stringify(moduleUrl)}); process.stdout.write(m.ENVIRONMENT.CURRENT_API_URL);`;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
}

test('default API URL uses nightviz.ai with the supported CLI', () => {
  assert.equal(currentApiUrl(undefined), 'https://api.nightviz.ai/api/v1/');
});

test('NIGHTVISION_API_URL is honored on either domain', () => {
  assert.equal(currentApiUrl('https://api.nightviz.ai/api/v1/'), 'https://api.nightviz.ai/api/v1/');
  assert.equal(currentApiUrl('https://api.nightvision.net/api/v1/'), 'https://api.nightvision.net/api/v1/');
  assert.equal(currentApiUrl('https://api.test.nightviz.ai/api/v1/'), 'https://api.test.nightviz.ai/api/v1/');
  assert.equal(currentApiUrl('https://self-hosted.example/api/v1/'), 'https://self-hosted.example/api/v1/');
});
