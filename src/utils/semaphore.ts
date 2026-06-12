/**
 * Minimal in-process concurrency limiter. Caps how many tasks run through
 * run() at once; additional calls queue until a slot frees. A freed slot is
 * handed directly to the next waiter, and the slot is always released (even if
 * the task throws), so it cannot leak or deadlock.
 */
export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(max: number) {
    this.available = max;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.available > 0) {
      this.available--;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiters.shift();
      if (next) {
        next();
      } else {
        this.available++;
      }
    }
  }
}
