import { checkReachability, type ReachabilityResult } from './reachability.js';

type ReachabilityChecker = (url: string, timeoutSeconds?: number) => Promise<ReachabilityResult>;

export interface RuntimeResolution {
  target_url: string | null;
  checked_urls: ReachabilityResult[];
}

/**
 * Resolve the DAST target URL for the guided harness.
 *
 * The agent driving this harness runs on the developer's own machine with full
 * access to the app it just built or changed, so it already knows the app's URL.
 * We therefore REQUIRE the caller to pass target_url and only confirm the app is
 * actually reachable. We deliberately do NOT scrape READMEs/.env/k8s files, probe
 * common ports, or otherwise guess: guessing is what created the "scanned the
 * wrong thing" and SSRF-pivot risks, and it is unnecessary when the caller knows
 * the URL. A missing URL is a clear blocker for the agent to fill in, not a cue
 * to hunt for one.
 */
export async function resolveTargetUrl(
  providedUrl: string | undefined,
  timeoutSeconds = 5,
  reachabilityChecker: ReachabilityChecker = checkReachability
): Promise<RuntimeResolution> {
  if (!providedUrl) {
    return { target_url: null, checked_urls: [] };
  }
  const result = await reachabilityChecker(providedUrl, timeoutSeconds);
  return {
    target_url: result.reachable ? providedUrl : null,
    checked_urls: [result]
  };
}
