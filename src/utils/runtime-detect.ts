import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { checkReachability, type ReachabilityResult } from './reachability.js';

const COMMON_PORTS = [3000, 3001, 3002, 5173, 8000, 8080, 8081, 5000, 5001, 4000, 4200, 8888, 9000, 9001];
type ReachabilityChecker = (url: string, timeoutSeconds?: number) => Promise<ReachabilityResult>;

const URL_PATTERN = /https?:\/\/[^\s"'`<>),]+/g;

export type RuntimeSource = 'provided' | 'detected' | 'detected_common_port' | 'not_found';

/**
 * Decide whether a URL points at a local or private/internal target that is a
 * legitimate DAST scan candidate for the guided harness. NightVision scans
 * private targets through the Smart Proxy relay, so localhost, RFC1918,
 * link-local, cluster-internal, and bare single-label service hostnames are all
 * in scope. Anything that resolves to a public host (a README badge link, a docs
 * URL, an external API) is rejected so the harness never launches an attack scan
 * against third-party infrastructure it merely found text about.
 */
export function isPrivateHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;

  // Strip IPv6 brackets if any slipped through the URL parser.
  host = host.replace(/^\[|\]$/g, '');

  // Never treat the cloud metadata service as a legitimate scan target, even when
  // a repo references it. 169.254.169.254 (and its IPv6 alias) is the canonical
  // SSRF pivot, and each cloud also exposes it under a well-known hostname that
  // would otherwise slip through as private (metadata.google.internal via the
  // `.internal` suffix, instance-data via the no-dot rule). A user can still name
  // such a host explicitly via target_url, which bypasses this filter.
  if (
    host === '169.254.169.254' ||
    host === 'fd00:ec2::254' ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data' ||
    host === 'instance-data.ec2.internal'
  ) {
    return false;
  }

  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;

  // Internal/cluster DNS suffixes and bare single-label docker/compose service
  // names (no dot) are private by construction.
  if (
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.svc') ||
    host.endsWith('.cluster.local') ||
    host.endsWith('.svc.cluster.local') ||
    !host.includes('.')
  ) {
    return true;
  }

  // IPv4 private ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    // 169.254.0.0/16 link-local (including the metadata IP handled above) is
    // never auto-adopted as a scan target.
    return false;
  }

  // Anything else with a colon is an IPv4-mapped IPv6 form (a bare IPv6 literal
  // has no dot and was already accepted as private by the no-dot rule above).
  // Gating the fc/fd unique-local check on ':' is what keeps public domains that
  // merely START WITH fc/fd/fe80 (fdic.gov, fcbarcelona.com) out of the private
  // set: they have a dot but no colon, so they fall through to `return false`.
  if (host.includes(':')) {
    return host.startsWith('fc') || host.startsWith('fd');
  }

  return false;
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function urlsFromText(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((match) => match[0].replace(/[.,;]+$/, ''));
}

function textFileUrls(projectPath: string): string[] {
  const candidates: string[] = [];
  for (const name of [
    '.env',
    '.env.local',
    '.env.development',
    'README.md',
    'README',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
    'package.json'
  ]) {
    candidates.push(...urlsFromText(safeRead(path.join(projectPath, name))));
  }
  return candidates;
}

function composeUrls(projectPath: string): string[] {
  const urls: string[] = [];
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const text = safeRead(path.join(projectPath, name));
    for (const match of text.matchAll(/(?:^|\s|["'])((?:127\.0\.0\.1|localhost):)?(\d{2,5}):(\d{2,5})(?:\s|["']|$)/gm)) {
      const host = match[1]?.replace(':', '') || 'localhost';
      urls.push(`http://${host}:${match[2]}`);
    }
  }
  return urls;
}

function packageScriptUrls(projectPath: string): string[] {
  const pkg = safeRead(path.join(projectPath, 'package.json'));
  if (!pkg) return [];
  const ports = new Set<string>();
  for (const match of pkg.matchAll(/(?:PORT=|--port\s+|-p\s+)(\d{2,5})/g)) {
    ports.add(match[1]);
  }
  return [...ports].flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
}

function walkYamlRoots(projectPath: string): string[] {
  const roots = [
    projectPath,
    path.join(projectPath, 'k8s'),
    path.join(projectPath, 'kubernetes'),
    path.join(projectPath, 'deploy'),
    path.join(projectPath, 'deployments'),
    path.join(projectPath, 'manifests')
  ].filter((dir) => existsSync(dir));
  const files: string[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(root, entry);
      try {
        const stat = statSync(full);
        if (stat.isFile() && /\.(ya?ml)$/i.test(entry)) {
          files.push(full);
        }
      } catch {
        // Ignore unreadable files.
      }
    }
  }
  return [...new Set(files)];
}

// Structural k8s evidence: the ingress `host:` field is a declared serving
// endpoint for THIS app, so it is trusted even when the hostname does not match a
// generic private range (internal cluster domains often do not).
function kubernetesIngressHosts(projectPath: string): string[] {
  const urls: string[] = [];
  for (const file of walkYamlRoots(projectPath)) {
    const text = safeRead(file);
    for (const match of text.matchAll(/^\s*-?\s*host:\s*["']?([^"'\s]+)["']?\s*$/gm)) {
      const host = match[1];
      if (host && (host.includes('.') || host.includes('localhost'))) {
        urls.push(`https://${host}`, `http://${host}`);
      }
    }
  }
  return urls;
}

// Free-text URLs scraped out of k8s YAML (annotations, comments, image refs).
function kubernetesFreeTextUrls(projectPath: string): string[] {
  const urls: string[] = [];
  for (const file of walkYamlRoots(projectPath)) {
    urls.push(...urlsFromText(safeRead(file)));
  }
  return urls;
}

/**
 * URLs the repo's own configuration points at, split by trust level:
 *
 *  - Structural evidence (compose port mappings, package scripts, k8s ingress
 *    host fields) is a declared serving endpoint for THIS app and is trusted
 *    as-is.
 *  - Free-text URLs scraped from README/.env/k8s prose can be anything (badges,
 *    docs links, third-party services, SDK DSNs), so they are kept only when they
 *    resolve to a local/private host. This is what prevents the harness from
 *    launching a DAST attack against unrelated external infrastructure it merely
 *    found a link to.
 */
function evidenceUrls(projectPath: string): string[] {
  const structural = [
    ...composeUrls(projectPath),
    ...packageScriptUrls(projectPath),
    ...kubernetesIngressHosts(projectPath)
  ];
  const freeText = [
    ...textFileUrls(projectPath),
    ...kubernetesFreeTextUrls(projectPath)
  ].filter(isPrivateHost);
  return [...new Set([...structural, ...freeText])];
}

/**
 * Blind localhost probes on common dev-server ports. Not tied to this repo, so a
 * reachable one might be an unrelated local service; adopting it is low
 * confidence and the caller is expected to warn/confirm before scanning.
 */
function commonPortUrls(): string[] {
  return COMMON_PORTS.flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
}

export interface RuntimeDetection {
  target_url: string | null;
  source: RuntimeSource;
  confidence: 'high' | 'low' | 'none';
  checked_urls: ReachabilityResult[];
}

export async function detectRuntimeUrl(
  projectPath: string,
  providedUrl?: string,
  timeoutSeconds = 5,
  reachabilityChecker: ReachabilityChecker = checkReachability
): Promise<RuntimeDetection> {
  // An explicitly provided URL is trusted as-is (the user/agent named it); we
  // still confirm reachability but never substitute a different URL for it.
  if (providedUrl) {
    const result = await reachabilityChecker(providedUrl, timeoutSeconds);
    return {
      target_url: result.reachable ? providedUrl : null,
      source: result.reachable ? 'provided' : 'not_found',
      confidence: result.reachable ? 'high' : 'none',
      checked_urls: [result]
    };
  }

  const evidence = evidenceUrls(projectPath);
  const probes = commonPortUrls().filter((url) => !evidence.includes(url));
  const checked: ReachabilityResult[] = [];

  // Prefer repo-referenced URLs (high confidence) before falling back to blind
  // common-port probes (low confidence). Both are already private-host only.
  for (const url of evidence) {
    const result = await reachabilityChecker(url, timeoutSeconds);
    checked.push(result);
    if (result.reachable) {
      // Structural evidence (compose ports, package scripts, k8s ingress hosts)
      // is trusted enough to adopt, but a repo fully controls its own manifests,
      // so a public-looking host derived from them is only LOW confidence: the
      // harness must warn and have the operator confirm before trusting an attack
      // scan against it. Private/loopback/internal hosts stay high confidence.
      const confidence = isPrivateHost(url) ? 'high' : 'low';
      return { target_url: url, source: 'detected', confidence, checked_urls: checked };
    }
  }

  for (const url of probes) {
    const result = await reachabilityChecker(url, timeoutSeconds);
    checked.push(result);
    if (result.reachable) {
      return { target_url: url, source: 'detected_common_port', confidence: 'low', checked_urls: checked };
    }
  }

  return { target_url: null, source: 'not_found', confidence: 'none', checked_urls: checked };
}
