/**
 * Minimal in-memory sliding-window rate limiter for machine API clients.
 *
 * This is a per-isolate limiter: it is a documented integration point, not a
 * complete substitute for edge rate limiting. The recommended production
 * setup (Cloudflare WAF / rate limiting rules keyed on the machine client's
 * token hash or IP) is documented in docs/security.md.
 */

export interface RateLimitDecision {
  ok: boolean;
  retryAfterSeconds?: number;
}

export class InMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const window = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (window.length >= this.limit) {
      this.hits.set(key, window);
      const oldest = window[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { ok: false, retryAfterSeconds };
    }
    window.push(now);
    this.hits.set(key, window);
    return { ok: true };
  }

  /** Test helper: clear all state. */
  reset(): void {
    this.hits.clear();
  }
}

export const MACHINE_RATE_LIMIT = 120;
export const MACHINE_RATE_WINDOW_MS = 60 * 1000;