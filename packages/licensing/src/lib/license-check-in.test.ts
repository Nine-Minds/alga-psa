import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertLicenseState = vi.fn();
const getLicenseStateRow = vi.fn();
vi.mock('./license-state', () => ({
  upsertLicenseState: (...a: unknown[]) => upsertLicenseState(...a),
  getLicenseStateRow: (...a: unknown[]) => getLicenseStateRow(...a),
}));

import {
  applyCheckInResult,
  checkInStateUpdate,
  interpretCheckInResponse,
  parseCheckInSubscription,
} from './license-check-in';

const NOW = new Date('2026-10-15T12:00:00Z');

describe('parseCheckInSubscription (defensive)', () => {
  it('returns null for absent or non-object values', () => {
    for (const v of [undefined, null, 'x', 5, [], true]) expect(parseCheckInSubscription(v)).toBeNull();
  });

  it('parses a full object', () => {
    expect(
      parseCheckInSubscription({
        state: 'cancel_scheduled',
        cancels_at: '2026-11-01T00:00:00.000Z',
        license_valid_until: 1800000000,
        resubscribe_url: 'https://portal.example/r',
      }),
    ).toEqual({
      state: 'cancel_scheduled',
      cancelsAt: new Date('2026-11-01T00:00:00.000Z'),
      licenseValidUntil: 1800000000,
      resubscribeUrl: 'https://portal.example/r',
      nextRetryAt: null,
      updatePaymentUrl: null,
      endReason: null,
    });
  });

  it('ignores malformed fields individually and never throws', () => {
    expect(
      parseCheckInSubscription({
        state: 'bogus',
        cancels_at: 'not a date',
        license_valid_until: 'soon',
        resubscribe_url: 'javascript:alert(1)',
        extra: { nested: true },
      }),
    ).toEqual({ state: null, cancelsAt: null, licenseValidUntil: null, resubscribeUrl: null, nextRetryAt: null, updatePaymentUrl: null, endReason: null });
  });
});

describe('interpretCheckInResponse', () => {
  it('legacy ok without subscription', () => {
    expect(interpretCheckInResponse(200, { status: 'ok', jwt: 'a.b.c', exp: 10 })).toEqual({
      kind: 'ok', jwt: 'a.b.c', exp: 10, subscription: null,
    });
  });

  it('legacy bare revoked is a lapse with no context', () => {
    expect(interpretCheckInResponse(200, { status: 'revoked' })).toEqual({ kind: 'lapsed', subscription: null });
  });

  it('revoked with cancelled context', () => {
    const r = interpretCheckInResponse(200, {
      status: 'revoked',
      subscription: { state: 'cancelled', license_valid_until: 5, resubscribe_url: 'https://p/x' },
    });
    expect(r).toMatchObject({ kind: 'lapsed', subscription: { state: 'cancelled', resubscribeUrl: 'https://p/x' } });
  });

  it('401 is a hard credential revocation, distinct from a lapse', () => {
    expect(interpretCheckInResponse(401, { code: 'revoked_appliance' })).toEqual({ kind: 'credential_revoked' });
    expect(interpretCheckInResponse(401, undefined)).toEqual({ kind: 'credential_revoked' });
  });

  it('5xx is transient; other statuses and junk bodies are rejected', () => {
    expect(interpretCheckInResponse(503, undefined)).toEqual({ kind: 'server_error', httpStatus: 503 });
    expect(interpretCheckInResponse(404, {})).toEqual({ kind: 'rejected', httpStatus: 404 });
    expect(interpretCheckInResponse(200, 'html')).toEqual({ kind: 'rejected', httpStatus: 200 });
    expect(interpretCheckInResponse(200, { status: 'weird' })).toEqual({ kind: 'rejected', httpStatus: 200 });
  });

  it('malformed subscription payload degrades to no context', () => {
    expect(interpretCheckInResponse(200, { status: 'ok', jwt: 'j', exp: 1, subscription: 'garbage' })).toMatchObject({
      kind: 'ok', subscription: null,
    });
  });
});

describe('checkInStateUpdate', () => {
  const clearedCtx = {
    subscription_state: null,
    subscription_cancels_at: null,
    subscription_resubscribe_url: null,
    subscription_context_updated_at: null,
    subscription_next_retry_at: null,
    subscription_update_payment_url: null,
    subscription_end_reason: null,
  };

  it('legacy ok stores the new token and clears any context', () => {
    const r = interpretCheckInResponse(200, { status: 'ok', jwt: 'new', exp: 1 });
    expect(checkInStateUpdate(r, 'old', NOW)).toEqual({ license_token: 'new', ...clearedCtx, last_checkin_at: NOW });
  });

  it('ok with an unchanged token does not rewrite the token', () => {
    const r = interpretCheckInResponse(200, { status: 'ok', jwt: 'same', exp: 1 });
    expect(checkInStateUpdate(r, 'same', NOW)).not.toHaveProperty('license_token');
  });

  it('cancel_scheduled is stored with date and URL (and the new token)', () => {
    const r = interpretCheckInResponse(200, {
      status: 'ok', jwt: 'new', exp: 1,
      subscription: { state: 'cancel_scheduled', cancels_at: '2026-11-01T00:00:00Z', resubscribe_url: 'https://p/x' },
    });
    expect(checkInStateUpdate(r, 'old', NOW)).toEqual({
      license_token: 'new',
      subscription_state: 'cancel_scheduled',
      subscription_cancels_at: new Date('2026-11-01T00:00:00Z'),
      subscription_resubscribe_url: 'https://p/x',
      subscription_context_updated_at: NOW,
      subscription_next_retry_at: null,
      subscription_update_payment_url: null,
      subscription_end_reason: null,
      last_checkin_at: NOW,
    });
  });

  it('term_ends parses and is stored (and an unknown state parses to null and clears)', () => {
    expect(parseCheckInSubscription({ state: 'term_ends', cancels_at: '2026-11-01T00:00:00Z' })?.state).toBe('term_ends');
    expect(parseCheckInSubscription({ state: 'term_endz' })?.state).toBeNull();
    const r = interpretCheckInResponse(200, {
      status: 'ok', jwt: 'new', exp: 1,
      subscription: { state: 'term_ends', cancels_at: '2026-11-01T00:00:00Z' },
    });
    expect(checkInStateUpdate(r, 'old', NOW)).toMatchObject({
      subscription_state: 'term_ends',
      subscription_cancels_at: new Date('2026-11-01T00:00:00Z'),
    });
    const unknown = interpretCheckInResponse(200, { status: 'ok', jwt: 'new', exp: 1, subscription: { state: 'term_endz' } });
    expect(checkInStateUpdate(unknown, 'old', NOW)).toMatchObject({ subscription_state: null });
  });

  it('cancelled / revoked stores the lapse and NEVER touches the token (grace)', () => {
    const r = interpretCheckInResponse(200, { status: 'revoked', subscription: { state: 'cancelled' } });
    const u = checkInStateUpdate(r, 'old', NOW)!;
    expect(u).not.toHaveProperty('license_token');
    expect(u).toMatchObject({ subscription_state: 'cancelled', last_checkin_at: NOW });
  });

  it('legacy bare revoked still marks the lapse', () => {
    const u = checkInStateUpdate(interpretCheckInResponse(200, { status: 'revoked' }), 'old', NOW)!;
    expect(u).toMatchObject({ subscription_state: 'cancelled', subscription_cancels_at: null, subscription_resubscribe_url: null });
  });

  it('ok after a cancel (state active) clears the context — reactivation', () => {
    const r = interpretCheckInResponse(200, { status: 'ok', jwt: 'fresh', exp: 9, subscription: { state: 'active' } });
    expect(checkInStateUpdate(r, 'stale', NOW)).toMatchObject({ license_token: 'fresh', ...clearedCtx });
  });

  it('writes nothing for a credential revocation or errors', () => {
    expect(checkInStateUpdate({ kind: 'credential_revoked' }, 'old', NOW)).toBeNull();
    expect(checkInStateUpdate({ kind: 'server_error', httpStatus: 500 }, 'old', NOW)).toBeNull();
    expect(checkInStateUpdate({ kind: 'rejected', httpStatus: 404 }, 'old', NOW)).toBeNull();
  });
});

describe('applyCheckInResult', () => {
  beforeEach(() => {
    upsertLicenseState.mockReset();
    getLicenseStateRow.mockReset();
  });

  it('persists via upsertLicenseState using the given row', async () => {
    await applyCheckInResult(interpretCheckInResponse(200, { status: 'revoked' }), { license_token: 'tok' } as any);
    expect(upsertLicenseState).toHaveBeenCalledWith(expect.objectContaining({ subscription_state: 'cancelled' }));
    expect(getLicenseStateRow).not.toHaveBeenCalled();
  });

  it('does not write on a hard revocation', async () => {
    getLicenseStateRow.mockResolvedValue({ license_token: 'tok' });
    expect(await applyCheckInResult({ kind: 'credential_revoked' })).toBeNull();
    expect(upsertLicenseState).not.toHaveBeenCalled();
  });
});

describe('payment_failed check-in context', () => {
  const failed = {
    state: 'payment_failed',
    nextRetryAt: '2026-11-05T12:00:00.000Z',
    updatePaymentUrl: 'https://invoice.stripe.com/i/abc',
    resubscribe_url: 'https://p/x',
  };

  it('parses every payment_failed field', () => {
    expect(parseCheckInSubscription(failed)).toMatchObject({
      state: 'payment_failed',
      nextRetryAt: new Date('2026-11-05T12:00:00.000Z'),
      updatePaymentUrl: 'https://invoice.stripe.com/i/abc',
      endReason: null,
    });
  });

  it('a bad date or a bad URL becomes null; the state is kept', () => {
    expect(parseCheckInSubscription({ state: 'payment_failed', nextRetryAt: 'nope', updatePaymentUrl: 'javascript:alert(1)' })).toMatchObject({
      state: 'payment_failed', nextRetryAt: null, updatePaymentUrl: null,
    });
    expect(parseCheckInSubscription({ state: 'payment_failed', nextRetryAt: null })?.nextRetryAt).toBeNull();
  });

  it('cancelled keeps endReason payment_failed only; anything else is dropped', () => {
    expect(parseCheckInSubscription({ state: 'cancelled', endReason: 'payment_failed' })?.endReason).toBe('payment_failed');
    expect(parseCheckInSubscription({ state: 'cancelled', endReason: 'fraud' })?.endReason).toBeNull();
  });

  it('a legacy payload without the new fields parses as before, and an unknown state is ignored', () => {
    expect(parseCheckInSubscription({ state: 'cancelled', cancels_at: '2026-11-01T00:00:00Z' })).toMatchObject({
      state: 'cancelled', nextRetryAt: null, updatePaymentUrl: null, endReason: null,
    });
    expect(parseCheckInSubscription({ state: 'payment_pending', nextRetryAt: '2026-11-05T12:00:00.000Z' })?.state).toBeNull();
  });

  it('payment_failed stores state, retry date and URL without touching the token', () => {
    const r = interpretCheckInResponse(200, { status: 'no_change', subscription: failed });
    expect(checkInStateUpdate(r, 'tok', NOW)).toEqual({
      subscription_state: 'payment_failed',
      subscription_cancels_at: null,
      subscription_resubscribe_url: 'https://p/x',
      subscription_context_updated_at: NOW,
      subscription_next_retry_at: new Date('2026-11-05T12:00:00.000Z'),
      subscription_update_payment_url: 'https://invoice.stripe.com/i/abc',
      subscription_end_reason: null,
      last_checkin_at: NOW,
    });
  });

  it('active clears all three payment columns (automatic recovery)', () => {
    const r = interpretCheckInResponse(200, { status: 'ok', jwt: 'tok', exp: 1, subscription: { state: 'active' } });
    expect(checkInStateUpdate(r, 'tok', NOW)).toMatchObject({
      subscription_state: null,
      subscription_next_retry_at: null,
      subscription_update_payment_url: null,
      subscription_end_reason: null,
    });
  });

  it('a lapse stores the end reason; a bare lapse stores null', () => {
    const r = interpretCheckInResponse(200, { status: 'revoked', subscription: { state: 'cancelled', endReason: 'payment_failed' } });
    expect(checkInStateUpdate(r, 'tok', NOW)).toMatchObject({ subscription_state: 'cancelled', subscription_end_reason: 'payment_failed' });
    expect(checkInStateUpdate(interpretCheckInResponse(200, { status: 'revoked' }), 'tok', NOW)).toMatchObject({ subscription_end_reason: null });
  });
});
