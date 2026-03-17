/**
 * Simple in-memory token-bucket rate limiter.
 *
 * Each "bucket" is keyed by an arbitrary string (e.g. IP address or route).
 * Tokens refill at a constant rate up to the configured capacity.
 *
 * Usage:
 *   const limiter = new RateLimiter({ capacity: 60, refillPerSecond: 1 });
 *   if (!limiter.consume('127.0.0.1')) {
 *     res.writeHead(429); res.end('Too Many Requests'); return;
 *   }
 */

interface BucketState {
  tokens: number;
  lastRefill: number; // ms since epoch
}

export interface RateLimiterOptions {
  /** Maximum tokens in the bucket (= burst limit). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly buckets = new Map<string, BucketState>();

  constructor(opts: RateLimiterOptions) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerSecond / 1000;
  }

  /**
   * Try to consume one token from the bucket identified by `key`.
   * Returns true if the request is allowed, false if rate-limited.
   */
  consume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Periodically prune stale buckets to prevent unbounded memory growth. */
  pruneStale(maxAgeMs = 5 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) this.buckets.delete(key);
    }
  }
}

/**
 * Shared limiters used by dashboard and peer daemon.
 *
 * api:     60 req/min burst, 1/s steady  — general API calls
 * chat:    10 req/min burst, 0.17/s      — expensive LLM calls
 */
export const apiLimiter  = new RateLimiter({ capacity: 60,  refillPerSecond: 1    });
export const chatLimiter = new RateLimiter({ capacity: 10,  refillPerSecond: 0.17 });

// Prune stale buckets every 5 minutes
setInterval(() => {
  apiLimiter.pruneStale();
  chatLimiter.pruneStale();
}, 5 * 60 * 1000).unref();
