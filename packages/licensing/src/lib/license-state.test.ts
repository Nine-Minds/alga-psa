import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSelfHostTier, type LicenseStateRow } from './license-state';
import { clearLicenseVerifyCache } from './verify-license';
import { checkInStateUpdate, interpretCheckInResponse } from './license-check-in';

// Fixture tokens from verify-license.test.ts (signed with v1-test key).
const VALID_PRO_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMSIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODM4MjMxNTMsImV4cCI6MTgxNTM1OTE1M30.E3uQWkwlsZ0MKSpTrb88yptO0zLIKEQJM0sHrDMiMFyXdviYplhSBDfGr4vU9T5eBDJpoCZ0urRXMwA22Ow8Rg';
const EXPIRED_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMiIsInRpZXIiOiJwcm8iLCJpYXQiOjE3MjA3NTExNTMsImV4cCI6MTc1MjI4NzE1M30.htsL34WWTjMpA0Go8mPxqZ8HY4I8qmqawzhCqNaqmAK9XMVgiOX13tOQ2WVx-N2ljpAkAzMkKue5b-32KOsUlQ';
const PREMIUM_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMyIsInRpZXIiOiJwcmVtaXVtIiwiaWF0IjoxNzgzODIzMTUzLCJleHAiOjE4MTUzNTkxNTN9.hv7CKr60F7gQ96UNuk2wlhvHiNzdRMoCEcWP5HVM5P0_bICxVz5n1zaCHbgonvceNp5VH-qVcAgaUTfbEZIw1w';

function makeRow(overrides: Partial<LicenseStateRow> = {}): LicenseStateRow {
  return {
    id: 1,
    edition_choice: 'ee',
    trial_started_at: null,
    license_token: null,
    updated_at: new Date(),
    appliance_id: null,
    check_in_url: null,
    appliance_credential: null,
    last_checkin_at: null,
    ...overrides,
  };
}

describe('resolveSelfHostTier', () => {
  beforeEach(() => clearLicenseVerifyCache());

  // T008: no row → null
  it('returns null when no row exists (SaaS mode)', () => {
    expect(resolveSelfHostTier(null)).toBeNull();
  });

  // T009: valid license → license.tier
  it('returns license.tier for a valid unexpired license', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: VALID_PRO_TOKEN }));
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('pro');
    expect(result?.expiresAt).toBeInstanceOf(Date);
    expect(result?.daysRemaining).toBeGreaterThan(0);
  });

  it('returns Pro for a valid legacy Premium license', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: PREMIUM_TOKEN }));
    expect(result?.tier).toBe('pro');
    expect(result?.state).toBe('licensed');
  });

  // T010: active trial → Pro
  it('returns Pro during an active 15-day trial', () => {
    const trialStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const result = resolveSelfHostTier(makeRow({ trial_started_at: trialStart }));
    expect(result?.state).toBe('trial');
    expect(result?.tier).toBe('pro');
    expect(result?.daysRemaining).toBeGreaterThan(0);
    expect(result?.daysRemaining).toBeLessThanOrEqual(10);
  });

  // T011: trial expired → essentials
  it('returns essentials after the 15-day trial window elapses', () => {
    const trialStart = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000); // 16 days ago
    const result = resolveSelfHostTier(makeRow({ trial_started_at: trialStart }));
    expect(result?.state).toBe('trial_expired');
    expect(result?.tier).toBe('essentials');
  });

  // T012: license expired → essentials
  it('returns essentials when the license has expired', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: EXPIRED_TOKEN }));
    expect(result?.state).toBe('license_expired');
    expect(result?.tier).toBe('essentials');
  });

  // T013: CE choice → essentials
  it('returns essentials for edition_choice = ce', () => {
    const result = resolveSelfHostTier(makeRow({ edition_choice: 'ce' }));
    expect(result?.state).toBe('ce');
    expect(result?.tier).toBe('essentials');
  });

  // T014: self-host mode supersedes tenants.plan (tested implicitly via null check)
  it('returns self-host resolved tier regardless of plan column', () => {
    // The row itself doesn't carry a plan column — the test proves the resolver
    // runs at all when a row is present, returning essentials for an ee choice
    // with no trial and no license.
    const result = resolveSelfHostTier(makeRow({ edition_choice: 'ee' }));
    expect(result?.tier).toBe('essentials');
    // Fresh ee install with no trial used: trial_available, NOT trial_expired —
    // the expired state (and its banner) is reserved for an actually-elapsed trial.
    expect(result?.state).toBe('trial_available');
  });

  it('license takes precedence over an active trial', () => {
    const trialStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const result = resolveSelfHostTier(makeRow({ license_token: VALID_PRO_TOKEN, trial_started_at: trialStart }));
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('pro');
  });
});

describe('resolveSelfHostTier — subscription lapse boundary', () => {
  beforeEach(() => clearLicenseVerifyCache());

  const cancelled = {
    subscription_state: 'cancelled' as const,
    subscription_resubscribe_url: 'https://portal.example/resubscribe',
  };

  it('before exp: still licensed (Pro) with an ending-subscription warning ending at the token exp', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: VALID_PRO_TOKEN, ...cancelled }));
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('pro');
    expect(result?.subscription).toEqual({
      phase: 'ending',
      cause: 'cancelled',
      endsAt: result?.expiresAt,
      resubscribeUrl: 'https://portal.example/resubscribe',
    });
  });

  it('a scheduled cancel uses the known cancel date while still licensed', () => {
    const cancelsAt = new Date(Date.now() + 5 * 86400_000);
    const result = resolveSelfHostTier(
      makeRow({ license_token: VALID_PRO_TOKEN, subscription_state: 'cancel_scheduled', subscription_cancels_at: cancelsAt }),
    );
    expect(result?.state).toBe('licensed');
    expect(result?.subscription?.phase).toBe('ending');
    expect(result?.subscription?.endsAt).toEqual(cancelsAt);
  });

  it('term_ends is an ending warning with cause "term" (not a cancellation), using the grant end date', () => {
    const cancelsAt = new Date(Date.now() + 5 * 86400_000);
    const result = resolveSelfHostTier(
      makeRow({ license_token: VALID_PRO_TOKEN, subscription_state: 'term_ends', subscription_cancels_at: cancelsAt }),
    );
    expect(result?.state).toBe('licensed');
    expect(result?.subscription).toMatchObject({ phase: 'ending', cause: 'term', endsAt: cancelsAt });
  });

  it('active (a comp grant far from its end) yields no warning', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: VALID_PRO_TOKEN, subscription_state: 'active' }));
    expect(result?.state).toBe('licensed');
    expect(result?.subscription).toBeNull();
  });

  it('after exp: essentials / license_expired with the subscription-lapse reason and the exp date', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: EXPIRED_TOKEN, ...cancelled }));
    expect(result?.state).toBe('license_expired');
    expect(result?.tier).toBe('essentials');
    expect(result?.subscription?.phase).toBe('lapsed');
    expect(result?.subscription?.endsAt).toEqual(new Date(1752287153 * 1000));
    expect(result?.subscription?.resubscribeUrl).toBe('https://portal.example/resubscribe');
  });

  it('legacy lapse (no URL, no cancel date) still resolves with the token exp date', () => {
    const result = resolveSelfHostTier(makeRow({ license_token: EXPIRED_TOKEN, subscription_state: 'cancelled' }));
    expect(result?.subscription).toEqual({ phase: 'lapsed', cause: 'cancelled', endsAt: new Date(1752287153 * 1000), resubscribeUrl: null });
  });

  it('an expired token with no cancelled-subscription context stays a generic license_expired', () => {
    expect(resolveSelfHostTier(makeRow({ license_token: EXPIRED_TOKEN }))?.subscription).toBeNull();
    // active context does not make an expiry a "subscription lapse"
    expect(
      resolveSelfHostTier(makeRow({ license_token: EXPIRED_TOKEN, subscription_state: 'active' }))?.subscription,
    ).toBeNull();
    // cancel scheduled in the future + expired token = offline/check-in failure, not a lapse
    expect(
      resolveSelfHostTier(
        makeRow({ license_token: EXPIRED_TOKEN, subscription_state: 'cancel_scheduled', subscription_cancels_at: new Date(Date.now() + 86400_000) }),
      )?.subscription,
    ).toBeNull();
  });

  it('reactivated (fresh token, context cleared): licensed with no warning', () => {
    const result = resolveSelfHostTier(
      makeRow({
        license_token: VALID_PRO_TOKEN,
        subscription_state: null,
        subscription_cancels_at: null,
        subscription_resubscribe_url: null,
      }),
    );
    expect(result?.state).toBe('licensed');
    expect(result?.subscription).toBeNull();
  });
});


// A Stripe cancel request is now mirrored to alga-license, which reports it as
// `cancel_scheduled` + a real `cancels_at` while the subscription still runs.
// These walk the wire body through parse -> persisted columns -> resolved state.
describe('cancel_scheduled check-in, end to end', () => {
  beforeEach(() => clearLicenseVerifyCache());

  const CANCELS_AT = new Date(Date.now() + 9 * 86400_000);
  const NOW = new Date();
  const persist = (body: unknown, current: LicenseStateRow) => {
    const update = checkInStateUpdate(interpretCheckInResponse(200, body), current.license_token, NOW);
    return { ...current, ...update } as LicenseStateRow;
  };

  it('is persisted and resolves to an ending warning dated by cancels_at, not the token exp', () => {
    const row = persist(
      {
        status: 'ok',
        jwt: VALID_PRO_TOKEN,
        exp: 1815359153,
        subscription: { state: 'cancel_scheduled', cancels_at: CANCELS_AT.toISOString(), resubscribe_url: 'https://portal.example/resubscribe' },
      },
      makeRow({ license_token: VALID_PRO_TOKEN }),
    );
    expect(row).toMatchObject({ subscription_state: 'cancel_scheduled', subscription_cancels_at: CANCELS_AT });

    const result = resolveSelfHostTier(row);
    expect(result?.state).toBe('licensed');
    expect(result?.tier).toBe('pro');
    expect(result?.subscription).toEqual({
      phase: 'ending',
      cause: 'cancelled',
      endsAt: CANCELS_AT,
      resubscribeUrl: 'https://portal.example/resubscribe',
    });
    expect(result?.subscription?.endsAt).not.toEqual(result?.expiresAt);
  });

  it('a later active check-in after a resubscribe clears the warning', () => {
    const scheduled = persist(
      { status: 'ok', jwt: VALID_PRO_TOKEN, exp: 1815359153, subscription: { state: 'cancel_scheduled', cancels_at: CANCELS_AT.toISOString(), resubscribe_url: 'https://portal.example/r' } },
      makeRow({ license_token: VALID_PRO_TOKEN }),
    );
    expect(resolveSelfHostTier(scheduled)?.subscription?.phase).toBe('ending');

    // no_change with an explicit active verdict also clears (not just a re-signed token)
    const resubscribed = persist({ status: 'no_change', subscription: { state: 'active' } }, scheduled);
    expect(resubscribed).toMatchObject({
      subscription_state: null,
      subscription_cancels_at: null,
      subscription_resubscribe_url: null,
    });
    const result = resolveSelfHostTier(resubscribed);
    expect(result?.state).toBe('licensed');
    expect(result?.subscription).toBeNull();
  });

  it('a stored cancel date that has passed with an expired token resolves as a lapse', () => {
    const past = new Date(Date.now() - 86400_000);
    const row = persist(
      { status: 'no_change', subscription: { state: 'cancel_scheduled', cancels_at: past.toISOString() } },
      makeRow({ license_token: EXPIRED_TOKEN }),
    );
    expect(resolveSelfHostTier(row)?.subscription).toMatchObject({ phase: 'lapsed', cause: 'cancelled' });
  });
});
