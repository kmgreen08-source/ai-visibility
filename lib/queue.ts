// Minimal concurrency-limited task runner — a pull-based worker pool, no
// external dependency needed for a prototype's in-process queue.
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i], i);
    return next();
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => next());
  await Promise.all(lanes);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries with exponential backoff. Returns {result} on success or {error}
// after all attempts are exhausted — callers decide what "failed" means
// (e.g. persist a status:"error" row) rather than this throwing past them.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number }
): Promise<{ result: T; retryCount: number } | { error: Error; retryCount: number }> {
  let lastError: Error = new Error("unknown error");
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < opts.retries) await sleep(opts.baseDelayMs * Math.pow(3, attempt));
    }
  }
  return { error: lastError, retryCount: opts.retries };
}
