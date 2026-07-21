export interface ReachabilityResult {
  url: string;
  reachable: boolean;
  status_code?: number;
  error?: string;
}

function formatReachabilityError(error: any): string {
  const parts = [error?.message || String(error)];
  const cause = error?.cause;

  if (cause?.code) {
    parts.push(`code=${cause.code}`);
  }
  if (cause?.address) {
    parts.push(`address=${cause.address}`);
  }
  if (cause?.port) {
    parts.push(`port=${cause.port}`);
  }

  return parts.join(' ');
}

export async function checkReachability(
  url: string,
  timeoutSeconds = 5,
  fetchImpl: typeof fetch = fetch
): Promise<ReachabilityResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal
    });
    return { url, reachable: true, status_code: response.status };
  } catch (error: any) {
    return { url, reachable: false, error: formatReachabilityError(error) };
  } finally {
    clearTimeout(timeout);
  }
}
