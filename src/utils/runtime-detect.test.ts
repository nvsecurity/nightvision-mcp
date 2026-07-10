import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRuntimeUrl, isPrivateHost } from './runtime-detect.js';
import type { ReachabilityResult } from './reachability.js';

const reachAll = async (url: string): Promise<ReachabilityResult> => ({ url, reachable: true, status_code: 200 });

test('detectRuntimeUrl checks only the provided URL when one is supplied', async () => {
  const checked: string[] = [];
  const checker = async (url: string): Promise<ReachabilityResult> => {
    checked.push(url);
    return { url, reachable: false, error: 'connection refused' };
  };

  const result = await detectRuntimeUrl(
    process.cwd(),
    'http://127.0.0.1:4000',
    5,
    checker
  );

  assert.equal(result.target_url, null);
  assert.equal(result.source, 'not_found');
  assert.deepEqual(checked, ['http://127.0.0.1:4000']);
});

test('detectRuntimeUrl returns the first reachable detected URL', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-runtime-'));
  writeFileSync(path.join(root, '.env'), 'API_URL=http://internal.local:8080\n');
  const checker = async (url: string): Promise<ReachabilityResult> => ({
    url,
    reachable: url === 'http://internal.local:8080',
    status_code: url === 'http://internal.local:8080' ? 200 : undefined
  });

  const result = await detectRuntimeUrl(root, undefined, 5, checker);

  assert.equal(result.target_url, 'http://internal.local:8080');
  assert.equal(result.source, 'detected');
  assert.equal(result.checked_urls[0].url, 'http://internal.local:8080');
});

test('detectRuntimeUrl reads docker compose host port mappings', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-runtime-compose-'));
  writeFileSync(path.join(root, 'docker-compose.yml'), [
    'services:',
    '  api:',
    '    image: demo',
    '    ports:',
    '      - "9000:8080"',
    ''
  ].join('\n'));
  const checked: string[] = [];
  const checker = async (url: string): Promise<ReachabilityResult> => {
    checked.push(url);
    return {
      url,
      reachable: url === 'http://localhost:9000',
      status_code: url === 'http://localhost:9000' ? 200 : undefined
    };
  };

  const result = await detectRuntimeUrl(root, undefined, 5, checker);

  assert.equal(result.target_url, 'http://localhost:9000');
  assert.ok(checked.includes('http://localhost:9000'));
});

test('detectRuntimeUrl reads Kubernetes ingress hosts', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-runtime-k8s-'));
  const k8sDir = path.join(root, 'k8s');
  mkdirSync(k8sDir);
  writeFileSync(path.join(k8sDir, 'ingress.yaml'), [
    'apiVersion: networking.k8s.io/v1',
    'kind: Ingress',
    'spec:',
    '  rules:',
    '    - host: api.internal.example',
    ''
  ].join('\n'));
  const checker = async (url: string): Promise<ReachabilityResult> => ({
    url,
    reachable: url === 'https://api.internal.example',
    status_code: url === 'https://api.internal.example' ? 200 : undefined
  });

  const result = await detectRuntimeUrl(root, undefined, 5, checker);

  assert.equal(result.target_url, 'https://api.internal.example');
});

test('isPrivateHost accepts local/private/internal hosts and rejects public ones', () => {
  // Local / private / internal → in scope for Smart Proxy DAST.
  for (const url of [
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'http://10.1.2.3:8080',
    'http://192.168.1.10',
    'http://172.16.5.4:9000',
    'http://api.internal:8080',
    'http://web.svc.cluster.local',
    'http://my-service:8080', // bare docker/compose service name
    'https://staging.local'
  ]) {
    assert.equal(isPrivateHost(url), true, `${url} should be private`);
  }

  // Public hosts → must be rejected so we never attack third-party infra.
  for (const url of [
    'https://github.com/org/repo',
    'https://img.shields.io/badge/build-passing',
    'https://o123.ingest.sentry.io/456',
    'https://api.stripe.com',
    'http://8.8.8.8',
    'https://example.com',
    // Public domains that merely START WITH fc/fd/fe80 must not be mistaken for
    // IPv6 unique-local/link-local (regression: the fc/fd/fe80 prefix check used
    // to run against any hostname, not just IPv6 literals).
    'https://fdic.gov',
    'https://fcbarcelona.com',
    'https://fe80.example.com',
    // The cloud metadata endpoint and link-local range are the canonical SSRF
    // pivot and must never be auto-adopted as a scan target.
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.10.20',
    'http://[fd00:ec2::254]/latest/meta-data/'
  ]) {
    assert.equal(isPrivateHost(url), false, `${url} should be public`);
  }

  // Genuine IPv6 unique-local literals stay in scope.
  for (const url of ['http://[fd12:3456::1]:8080', 'http://[fc00::1]']) {
    assert.equal(isPrivateHost(url), true, `${url} should be private`);
  }
});

test('detectRuntimeUrl adopts a reachable k8s ingress host but at low confidence when it is public-looking', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-runtime-k8s-public-'));
  const k8sDir = path.join(root, 'k8s');
  mkdirSync(k8sDir);
  // A repo fully controls its own manifests, so a public-looking ingress host is
  // only adopted at LOW confidence so the harness warns before scanning it.
  writeFileSync(path.join(k8sDir, 'ingress.yaml'), [
    'apiVersion: networking.k8s.io/v1',
    'kind: Ingress',
    'spec:',
    '  rules:',
    '    - host: app.public-example.com',
    ''
  ].join('\n'));
  const checker = async (url: string): Promise<ReachabilityResult> => ({
    url,
    reachable: url === 'https://app.public-example.com',
    status_code: url === 'https://app.public-example.com' ? 200 : undefined
  });

  const result = await detectRuntimeUrl(root, undefined, 5, checker);

  assert.equal(result.target_url, 'https://app.public-example.com');
  assert.equal(result.confidence, 'low');
});

test('detectRuntimeUrl never adopts an external README/badge URL as the scan target', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-runtime-external-'));
  // A README full of external links, and NO reachable local app.
  writeFileSync(path.join(root, 'README.md'), [
    '# My App',
    '![build](https://img.shields.io/badge/build-passing)',
    'Docs: https://github.com/acme/myapp',
    'Status: https://status.acme.com',
    ''
  ].join('\n'));

  const checked: string[] = [];
  const checker = async (url: string): Promise<ReachabilityResult> => {
    checked.push(url);
    // Everything is reachable; if the filter were broken, an external URL would win.
    return { url, reachable: true, status_code: 200 };
  };

  const result = await detectRuntimeUrl(root, undefined, 5, checker);

  // The only reachable URLs it may adopt are local common-port probes, never an
  // external host scraped from the README.
  assert.ok(!checked.includes('https://img.shields.io/badge/build-passing'));
  assert.ok(!checked.includes('https://github.com/acme/myapp'));
  assert.ok(!checked.includes('https://status.acme.com'));
  if (result.target_url) {
    assert.equal(isPrivateHost(result.target_url), true);
  }
});

test('detectRuntimeUrl flags a blind common-port hit as low confidence', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-runtime-lowconf-'));
  // No repo config referencing a URL; only a blind localhost:3000 probe responds.
  const checker = async (url: string): Promise<ReachabilityResult> => ({
    url,
    reachable: url === 'http://localhost:3000',
    status_code: url === 'http://localhost:3000' ? 200 : undefined
  });

  const result = await detectRuntimeUrl(root, undefined, 5, checker);
  assert.equal(result.target_url, 'http://localhost:3000');
  assert.equal(result.source, 'detected_common_port');
  assert.equal(result.confidence, 'low');
});

test('detectRuntimeUrl marks a repo-referenced URL as high confidence', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-runtime-highconf-'));
  writeFileSync(path.join(root, 'docker-compose.yml'), [
    'services:',
    '  api:',
    '    ports:',
    '      - "8080:8080"',
    ''
  ].join('\n'));
  const result = await detectRuntimeUrl(root, undefined, 5, reachAll);
  assert.equal(result.confidence, 'high');
  assert.equal(result.source, 'detected');
});

test('detectRuntimeUrl trusts a provided URL as high confidence without substitution', async () => {
  const result = await detectRuntimeUrl(process.cwd(), 'http://127.0.0.1:4000', 5, reachAll);
  assert.equal(result.target_url, 'http://127.0.0.1:4000');
  assert.equal(result.source, 'provided');
  assert.equal(result.confidence, 'high');
});

test('detectRuntimeUrl detects the checked-in Express fixture compose port', async () => {
  const root = path.resolve('fixtures/demo-apps/express-api');
  const checker = async (url: string): Promise<ReachabilityResult> => ({
    url,
    reachable: url === 'http://localhost:9000',
    status_code: url === 'http://localhost:9000' ? 200 : undefined
  });

  const result = await detectRuntimeUrl(root, undefined, 5, checker);

  assert.equal(result.target_url, 'http://localhost:9000');
  assert.equal(result.source, 'detected');
});
