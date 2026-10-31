import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory license_state singleton behind a minimal knex fake, so the real
// shared check-in handling (interpret + persist) runs end to end.
const db = vi.hoisted(() => ({ row: null as Record<string, any> | null }));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => {
    const knex: any = (table: string) => {
      if (table !== 'license_state') throw new Error(`unexpected table ${table}`);
      const builder: any = {
        orderBy: () => builder,
        first: async () => db.row ?? undefined,
        where: () => builder,
        update: async (fields: Record<string, any>) => { db.row = { ...db.row, ...fields }; },
        insert: async (fields: Record<string, any>) => { db.row = { id: 1, ...fields }; },
      };
      return builder;
    };
    knex.fn = { now: () => new Date() };
    return knex;
  },
}));

vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'u1', tenant: 'tenant-1' })),
  localizeActionError: (e: unknown) => e,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

import { refreshLicenseNow } from '@/lib/actions/licenseManagementActions';
import { clearLicenseVerifyCache } from '@alga-psa/licensing';

// Fixture tokens signed with the v1-test key (see packages/licensing tests).
const VALID_PRO_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMSIsInRpZXIiOiJwcm8iLCJpYXQiOjE3ODM4MjMxNTMsImV4cCI6MTgxNTM1OTE1M30.E3uQWkwlsZ0MKSpTrb88yptO0zLIKEQJM0sHrDMiMFyXdviYplhSBDfGr4vU9T5eBDJpoCZ0urRXMwA22Ow8Rg';
const EXPIRED_TOKEN =
  'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxLXRlc3QifQ.eyJpc3MiOiJuaW5lbWluZHMtbGljZW5zZSIsImN1c3QiOiJUZXN0IENvcnAiLCJzdWIiOiJsaWNfdGVzdDAwMiIsInRpZXIiOiJwcm8iLCJpYXQiOjE3MjA3NTExNTMsImV4cCI6MTc1MjI4NzE1M30.htsL34WWTjMpA0Go8mPxqZ8HY4I8qmqawzhCqNaqmAK9XMVgiOX13tOQ2WVx-N2ljpAkAzMkKue5b-32KOsUlQ';

function baseRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    edition_choice: 'ee',
    trial_started_at: null,
    license_token: VALID_PRO_TOKEN,
    updated_at: new Date(),
    appliance_id: 'appliance-1',
    check_in_url: 'https://license.example/check-in',
    appliance_credential: 'cred',
    last_checkin_at: null,
    subscription_state: null,
    subscription_cancels_at: null,
    subscription_resubscribe_url: null,
    subscription_context_updated_at: null,
    ...overrides,
  };
}

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('refreshLicenseNow', () => {
  beforeEach(() => {
    clearLicenseVerifyCache();
    db.row = baseRow();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('legacy revoked (no subscription field): lapse wording, stored token kept, token-exp end date', async () => {
    mockFetch(200, { status: 'revoked' });
    const result = await refreshLicenseNow();

    expect(result.success).toBe(false);
    expect(result.code).toBe('subscription_lapsed');
    expect(result.error).not.toMatch(/contact support/i);
    expect(result.error).toMatch(/Pro subscription has been cancelled\. Pro ends on \d{4}-\d{2}-\d{2}/);
    // soft revocation never hard-cuts the token
    expect(db.row!.license_token).toBe(VALID_PRO_TOKEN);
    expect(db.row!.subscription_state).toBe('cancelled');
    expect(result.status?.subscription).toMatchObject({ phase: 'ending', resubscribeUrl: null });
    expect(result.status?.tier).toBe('pro');
  });

  it('revoked with subscription context stores date/URL and names the URL in the message', async () => {
    mockFetch(200, {
      status: 'revoked',
      subscription: { state: 'cancelled', cancels_at: '2030-01-05T00:00:00Z', resubscribe_url: 'https://portal.example/r' },
    });
    const result = await refreshLicenseNow();
    expect(result.error).toContain('Resubscribe at https://portal.example/r');
    expect(db.row!.subscription_resubscribe_url).toBe('https://portal.example/r');
  });

  it('lapse after the token has expired reports the free edition', async () => {
    db.row = baseRow({ license_token: EXPIRED_TOKEN });
    mockFetch(200, { status: 'revoked' });
    const result = await refreshLicenseNow();
    expect(result.status?.state).toBe('license_expired');
    expect(result.status?.subscription?.phase).toBe('lapsed');
    expect(result.error).toMatch(/free edition/);
  });

  it('payment_failed end (token still valid) says payment failed, never cancelled', async () => {
    mockFetch(200, {
      status: 'revoked',
      subscription: { state: 'cancelled', endReason: 'payment_failed', cancels_at: '2030-01-05T00:00:00Z' },
    });
    const result = await refreshLicenseNow();
    expect(result.code).toBe('subscription_lapsed');
    expect(result.status?.subscription).toMatchObject({ phase: 'ending', cause: 'payment_failed' });
    expect(result.error).toMatch(/^The Pro subscription ended — payment failed\. Pro ends on \d{4}-\d{2}-\d{2}\./);
    expect(result.error).not.toMatch(/cancelled/i);
  });

  it('payment_failed end after the token expired says Pro ended, never cancelled', async () => {
    db.row = baseRow({ license_token: EXPIRED_TOKEN });
    mockFetch(200, {
      status: 'revoked',
      subscription: { state: 'cancelled', endReason: 'payment_failed' },
    });
    const result = await refreshLicenseNow();
    expect(result.status?.subscription).toMatchObject({ phase: 'lapsed', cause: 'payment_failed' });
    expect(result.error).toMatch(/^Pro ended — payment failed\. This appliance runs Essentials\./);
    expect(result.error).not.toMatch(/cancelled/i);
  });

  it('an ordinary cancellation still says cancelled', async () => {
    mockFetch(200, {
      status: 'revoked',
      subscription: { state: 'cancelled', endReason: null, cancels_at: '2030-01-05T00:00:00Z' },
    });
    const result = await refreshLicenseNow();
    expect(result.error).toMatch(/Pro subscription has been cancelled\. Pro ends on \d{4}-\d{2}-\d{2}/);
  });

  it('cancel_scheduled ok stores the context and succeeds', async () => {
    mockFetch(200, {
      status: 'ok', jwt: VALID_PRO_TOKEN, exp: 1815359153,
      subscription: { state: 'cancel_scheduled', cancels_at: '2030-01-05T00:00:00Z', resubscribe_url: 'https://portal.example/r' },
    });
    const result = await refreshLicenseNow();
    expect(result.success).toBe(true);
    expect(result.status?.subscription).toMatchObject({ phase: 'ending', endsAt: '2030-01-05T00:00:00.000Z' });
  });

  it('ok after a cancel clears the context and restores Pro in the same write', async () => {
    db.row = baseRow({
      license_token: EXPIRED_TOKEN,
      subscription_state: 'cancelled',
      subscription_resubscribe_url: 'https://portal.example/r',
    });
    mockFetch(200, { status: 'ok', jwt: VALID_PRO_TOKEN, exp: 1815359153, subscription: { state: 'active' } });
    const result = await refreshLicenseNow();
    expect(result.success).toBe(true);
    expect(result.status).toMatchObject({ state: 'licensed', tier: 'pro', subscription: null });
    expect(db.row!.subscription_state).toBeNull();
    expect(db.row!.license_token).toBe(VALID_PRO_TOKEN);
  });

  it('legacy ok without a subscription field also clears stale context', async () => {
    db.row = baseRow({ subscription_state: 'cancelled' });
    mockFetch(200, { status: 'ok', jwt: VALID_PRO_TOKEN, exp: 1815359153 });
    const result = await refreshLicenseNow();
    expect(result.status?.subscription).toBeNull();
  });

  it('401 revoked_appliance gets its own credential-revoked message, not a lapse or generic HTTP error', async () => {
    mockFetch(401, { code: 'revoked_appliance' });
    const result = await refreshLicenseNow();
    expect(result.success).toBe(false);
    expect(result.code).toBe('credential_revoked');
    expect(result.error).toMatch(/credential was revoked/);
    expect(result.error).toMatch(/new claim code/);
    expect(result.error).not.toMatch(/HTTP 401/);
    expect(db.row!.subscription_state).toBeNull();
    expect(db.row!.license_token).toBe(VALID_PRO_TOKEN);
  });

  it('malformed subscription payload is ignored, never thrown', async () => {
    mockFetch(200, { status: 'ok', jwt: VALID_PRO_TOKEN, exp: 1815359153, subscription: { state: 7, cancels_at: {}, resubscribe_url: 'javascript:x' } });
    const result = await refreshLicenseNow();
    expect(result.success).toBe(true);
    expect(result.status?.subscription).toBeNull();
  });

  it('5xx keeps the generic retry message', async () => {
    mockFetch(503, {});
    const result = await refreshLicenseNow();
    expect(result.error).toMatch(/HTTP 503/);
    expect(result.code).toBeUndefined();
  });
});
