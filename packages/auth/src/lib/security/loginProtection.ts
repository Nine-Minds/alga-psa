// Imported from @auth/core directly (next-auth re-exports this same class) because
// next-auth's package entry does not import cleanly outside the Next.js runtime.
import { CredentialsSignin } from '@auth/core/errors';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import logger from '@alga-psa/core/logger';
import { isCaptchaConfigured, verifyCaptchaToken } from './captcha';

/**
 * Brute-force protection for the credentials sign-in path.
 *
 * Unlike `rateLimiting.ts` (a 'use server' module whose exports are client-invokable
 * server actions), this module must only ever be imported from server-side auth code:
 * exposing recordLoginSuccess/recordLoginFailure to browsers would let an attacker
 * reset or poison the counters.
 *
 * Counters are in-memory and therefore per-process: in a multi-replica deployment each
 * replica enforces the thresholds independently. That weakens the guarantee by a factor
 * of the replica count but keeps this dependency-free; swap RateLimiterMemory for
 * RateLimiterRedis here if a shared store becomes a requirement.
 */

/** Failed attempts per email+IP pair before sign-in is refused outright. */
const EMAIL_IP_MAX_FAILURES = 5;
/** Failed attempts per IP across all emails before sign-in is refused (catches password spraying). */
const IP_MAX_FAILURES = 30;
/** Failed attempts per email+IP pair after which a captcha is required (when configured). */
const CAPTCHA_AFTER_FAILURES = 3;
/** Failed attempts per IP across all emails after which a captcha is required (when configured). */
const CAPTCHA_AFTER_IP_FAILURES = 10;
/** Counter window; a key expires this many seconds after its first failure. */
const FAILURE_WINDOW_SECONDS = 15 * 60;

const emailIpFailures = new RateLimiterMemory({
  points: EMAIL_IP_MAX_FAILURES,
  duration: FAILURE_WINDOW_SECONDS,
});

const ipFailures = new RateLimiterMemory({
  points: IP_MAX_FAILURES,
  duration: FAILURE_WINDOW_SECONDS,
});

/**
 * Sign-in refused because too many failures accumulated. The code surfaces to the
 * login form via the `code` field of the NextAuth signIn() response.
 */
export class RateLimitedError extends CredentialsSignin {
  code = 'RATE_LIMITED';
}

/**
 * Sign-in requires a solved captcha (missing or invalid token on this attempt).
 * Only thrown when a captcha provider is configured.
 */
export class CaptchaRequiredError extends CredentialsSignin {
  code = 'CAPTCHA_REQUIRED';
}

export interface LoginAttemptContext {
  /** Normalized (trimmed, lowercased) email the attempt is for. */
  email: string;
  /** Client IP, or 'unknown' when it cannot be determined. */
  ip: string;
}

export interface LoginProtectionAssessment {
  blocked: boolean;
  captchaRequired: boolean;
  retryAfterMs?: number;
}

export function normalizeLoginEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function pairKey(ctx: LoginAttemptContext): string {
  return `${ctx.email}|${ctx.ip}`;
}

export async function assessLoginAttempt(ctx: LoginAttemptContext): Promise<LoginProtectionAssessment> {
  const [pairState, ipState] = await Promise.all([
    emailIpFailures.get(pairKey(ctx)),
    ipFailures.get(ctx.ip),
  ]);

  const pairCount = pairState?.consumedPoints ?? 0;
  const ipCount = ipState?.consumedPoints ?? 0;

  if (pairCount >= EMAIL_IP_MAX_FAILURES) {
    return { blocked: true, captchaRequired: false, retryAfterMs: pairState?.msBeforeNext };
  }
  if (ipCount >= IP_MAX_FAILURES) {
    return { blocked: true, captchaRequired: false, retryAfterMs: ipState?.msBeforeNext };
  }

  const overCaptchaThreshold = pairCount >= CAPTCHA_AFTER_FAILURES || ipCount >= CAPTCHA_AFTER_IP_FAILURES;
  const captchaRequired = overCaptchaThreshold && (await isCaptchaConfigured());

  return { blocked: false, captchaRequired };
}

/**
 * Record a failed password or 2FA-code attempt. Do NOT call this for flow signals
 * that are not evidence of guessing (missing 2FA code on first submit, malformed
 * input, wrong-portal logins after a correct password).
 */
export async function recordLoginFailure(ctx: LoginAttemptContext): Promise<void> {
  // consume() rejects once a key is exhausted; the rejection carries no information
  // we need here because enforcement happens via assessLoginAttempt() on the next try.
  await Promise.all([
    emailIpFailures.consume(pairKey(ctx)).catch(() => undefined),
    ipFailures.consume(ctx.ip).catch(() => undefined),
  ]);
}

/**
 * Clear the email+IP failure counter after a successful sign-in. The per-IP counter
 * is left in place so a spraying attacker cannot reset it with one valid account.
 */
export async function recordLoginSuccess(ctx: LoginAttemptContext): Promise<void> {
  try {
    await emailIpFailures.delete(pairKey(ctx));
  } catch (error) {
    logger.warn('[login-protection] Failed to clear failure counter after successful sign-in', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Gate a sign-in attempt before any credential checking happens.
 *
 * Throws RateLimitedError when the email+IP or IP failure budget is exhausted, and
 * CaptchaRequiredError when a captcha is due but the attempt carries no valid token.
 * Both subclass CredentialsSignin, so NextAuth surfaces their `code` to the client
 * instead of treating them as server errors.
 */
export async function enforceLoginProtection(params: {
  email: string;
  ip: string;
  captchaToken?: string;
}): Promise<void> {
  const ctx: LoginAttemptContext = { email: params.email, ip: params.ip };
  const assessment = await assessLoginAttempt(ctx);

  if (assessment.blocked) {
    logger.warn('[login-protection] Sign-in attempt blocked by rate limit', {
      email: ctx.email,
      ip: ctx.ip,
      retryAfterMs: assessment.retryAfterMs,
    });
    throw new RateLimitedError();
  }

  if (assessment.captchaRequired) {
    const token = typeof params.captchaToken === 'string' ? params.captchaToken.trim() : '';
    const valid = token.length > 0 && (await verifyCaptchaToken(token, ctx.ip));
    if (!valid) {
      logger.info('[login-protection] Captcha required for sign-in attempt', {
        email: ctx.email,
        ip: ctx.ip,
        hadToken: token.length > 0,
      });
      throw new CaptchaRequiredError();
    }
  }
}
