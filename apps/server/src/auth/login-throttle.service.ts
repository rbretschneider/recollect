import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Failures allowed before backoff starts. */
const FREE_ATTEMPTS = 5;
/** First lockout; doubles per failure past the free attempts. */
const BASE_LOCK_MS = 30_000;
/** Backoff ceiling — even a determined bot gets one guess per 15 minutes. */
const MAX_LOCK_MS = 15 * 60_000;
/** Forget a quiet key entirely after this long. */
const FORGET_AFTER_MS = 60 * 60_000;

interface FailureRecord {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

/**
 * Brute-force protection for login: exponential backoff per client IP.
 *
 * The lock is keyed on IP ONLY. An earlier version also locked on the account
 * email — but since an attacker chooses the email, that let anyone lock a known
 * victim out of their own account by burning failures against it from rotating
 * addresses. The email counter is still kept (it feeds no denial, only future
 * detection/telemetry), so a targeted lockout is impossible while per-IP
 * backoff still makes bulk guessing from one host impractical.
 *
 * In-memory by design — a restart forgiving the counters is acceptable, the
 * backoff math is what makes bulk guessing impractical.
 */
@Injectable()
export class LoginThrottleService {
  private readonly records = new Map<string, FailureRecord>();

  /** Throws 429 (with Retry-After semantics in the message) while the IP is locked. */
  assertAllowed(ip: string): void {
    this.prune();
    const record = this.records.get(`ip:${ip}`);
    if (record && record.lockedUntil > Date.now()) {
      const seconds = Math.ceil((record.lockedUntil - Date.now()) / 1000);
      throw new HttpException(
        `Too many attempts. Try again in ${seconds}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(ip: string, email: string): void {
    const now = Date.now();
    for (const key of this.keysFor(ip, email)) {
      const record = this.records.get(key) ?? { failures: 0, lockedUntil: 0, lastFailureAt: now };
      record.failures += 1;
      record.lastFailureAt = now;
      if (record.failures > FREE_ATTEMPTS) {
        const exponent = record.failures - FREE_ATTEMPTS - 1;
        record.lockedUntil = now + Math.min(BASE_LOCK_MS * 2 ** exponent, MAX_LOCK_MS);
      }
      this.records.set(key, record);
    }
  }

  recordSuccess(ip: string, email: string): void {
    for (const key of this.keysFor(ip, email)) {
      this.records.delete(key);
    }
  }

  private keysFor(ip: string, email: string): [string, string] {
    return [`ip:${ip}`, `email:${email.trim().toLowerCase()}`];
  }

  private prune(): void {
    const cutoff = Date.now() - FORGET_AFTER_MS;
    for (const [key, record] of this.records) {
      if (record.lastFailureAt < cutoff && record.lockedUntil < Date.now()) {
        this.records.delete(key);
      }
    }
  }
}
