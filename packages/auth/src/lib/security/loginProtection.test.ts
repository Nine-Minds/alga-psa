import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./captcha', () => ({
  isCaptchaConfigured: vi.fn(async () => false),
  verifyCaptchaToken: vi.fn(async () => false),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  CaptchaRequiredError,
  RateLimitedError,
  assessLoginAttempt,
  enforceLoginProtection,
  normalizeLoginEmail,
  recordLoginFailure,
  recordLoginSuccess,
} from './loginProtection';
import { isCaptchaConfigured, verifyCaptchaToken } from './captcha';

const mockIsCaptchaConfigured = vi.mocked(isCaptchaConfigured);
const mockVerifyCaptchaToken = vi.mocked(verifyCaptchaToken);

// The module-level limiters persist across tests, so every test uses a unique
// email/IP pair instead of attempting to reset shared state.
let seq = 0;
function freshContext() {
  seq += 1;
  return { email: `user${seq}@example.com`, ip: `10.0.${Math.floor(seq / 250)}.${seq % 250}` };
}

async function failTimes(ctx: { email: string; ip: string }, times: number) {
  for (let i = 0; i < times; i++) {
    await recordLoginFailure(ctx);
  }
}

beforeEach(() => {
  mockIsCaptchaConfigured.mockReset().mockResolvedValue(false);
  mockVerifyCaptchaToken.mockReset().mockResolvedValue(false);
});

describe('normalizeLoginEmail', () => {
  it('lowercases and trims, and maps non-strings to empty string', () => {
    expect(normalizeLoginEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeLoginEmail(undefined)).toBe('');
    expect(normalizeLoginEmail(42)).toBe('');
  });
});

describe('assessLoginAttempt', () => {
  it('allows a fresh attempt with no captcha', async () => {
    const ctx = freshContext();
    await expect(assessLoginAttempt(ctx)).resolves.toEqual({ blocked: false, captchaRequired: false });
  });

  it('requires a captcha after 3 failures when captcha is configured', async () => {
    mockIsCaptchaConfigured.mockResolvedValue(true);
    const ctx = freshContext();

    await failTimes(ctx, 2);
    await expect(assessLoginAttempt(ctx)).resolves.toMatchObject({ captchaRequired: false });

    await failTimes(ctx, 1);
    await expect(assessLoginAttempt(ctx)).resolves.toMatchObject({ blocked: false, captchaRequired: true });
  });

  it('never requires a captcha when none is configured', async () => {
    const ctx = freshContext();
    await failTimes(ctx, 4);
    await expect(assessLoginAttempt(ctx)).resolves.toMatchObject({ blocked: false, captchaRequired: false });
  });

  it('blocks after 5 failures for the same email and IP', async () => {
    const ctx = freshContext();
    await failTimes(ctx, 5);
    const assessment = await assessLoginAttempt(ctx);
    expect(assessment.blocked).toBe(true);
    expect(assessment.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks failures per IP across emails to catch password spraying', async () => {
    mockIsCaptchaConfigured.mockResolvedValue(true);
    const ip = '198.51.100.77';

    // 10 failures from the same IP, each against a different account.
    for (let i = 0; i < 10; i++) {
      await recordLoginFailure({ email: `spray${i}@example.com`, ip });
    }

    // A brand-new email on that IP is challenged even though its pair counter is empty.
    const assessment = await assessLoginAttempt({ email: 'fresh-target@example.com', ip });
    expect(assessment).toMatchObject({ blocked: false, captchaRequired: true });
  });

  it('clears the email+IP counter on success', async () => {
    mockIsCaptchaConfigured.mockResolvedValue(true);
    const ctx = freshContext();
    await failTimes(ctx, 4);
    await recordLoginSuccess(ctx);
    await expect(assessLoginAttempt(ctx)).resolves.toEqual({ blocked: false, captchaRequired: false });
  });
});

describe('enforceLoginProtection', () => {
  it('throws RateLimitedError with code RATE_LIMITED once the budget is exhausted', async () => {
    const ctx = freshContext();
    await failTimes(ctx, 5);
    const attempt = enforceLoginProtection(ctx);
    await expect(attempt).rejects.toBeInstanceOf(RateLimitedError);
    await expect(enforceLoginProtection(ctx)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('throws CaptchaRequiredError when a captcha is due and no token is supplied', async () => {
    mockIsCaptchaConfigured.mockResolvedValue(true);
    const ctx = freshContext();
    await failTimes(ctx, 3);
    const attempt = enforceLoginProtection(ctx);
    await expect(attempt).rejects.toBeInstanceOf(CaptchaRequiredError);
    await expect(enforceLoginProtection(ctx)).rejects.toMatchObject({ code: 'CAPTCHA_REQUIRED' });
    expect(mockVerifyCaptchaToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid captcha token', async () => {
    mockIsCaptchaConfigured.mockResolvedValue(true);
    mockVerifyCaptchaToken.mockResolvedValue(false);
    const ctx = freshContext();
    await failTimes(ctx, 3);
    await expect(enforceLoginProtection({ ...ctx, captchaToken: 'bad-token' })).rejects.toBeInstanceOf(
      CaptchaRequiredError
    );
    expect(mockVerifyCaptchaToken).toHaveBeenCalledWith('bad-token', ctx.ip);
  });

  it('admits the attempt when a valid captcha token is supplied', async () => {
    mockIsCaptchaConfigured.mockResolvedValue(true);
    mockVerifyCaptchaToken.mockResolvedValue(true);
    const ctx = freshContext();
    await failTimes(ctx, 3);
    await expect(enforceLoginProtection({ ...ctx, captchaToken: 'good-token' })).resolves.toBeUndefined();
  });

  it('still hard-blocks even with a valid captcha token', async () => {
    mockIsCaptchaConfigured.mockResolvedValue(true);
    mockVerifyCaptchaToken.mockResolvedValue(true);
    const ctx = freshContext();
    await failTimes(ctx, 5);
    await expect(enforceLoginProtection({ ...ctx, captchaToken: 'good-token' })).rejects.toBeInstanceOf(
      RateLimitedError
    );
  });
});
