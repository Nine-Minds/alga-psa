import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory license_state singleton behind a minimal knex fake: the activity
// reads the row with raw knex, the shared handler persists via upsertLicenseState.
const db = vi.hoisted(() => ({ row: null as Record<string, any> | null }));

const fakeAdmin = vi.hoisted(() => ({
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

vi.mock('@alga-psa/db/admin', () => fakeAdmin);
vi.mock('@alga-psa/db/admin.js', () => fakeAdmin);
vi.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }) },
}));

import { applianceLicenseCheckInActivity } from '../appliance-check-in-activities';

const OLD_TOKEN = 'old.token.value';
const NEW_TOKEN = 'new.token.value';

function row(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    edition_choice: 'ee',
    license_token: OLD_TOKEN,
    appliance_credential: 'cred',
    check_in_url: 'https://license.example/check-in',
    last_checkin_at: null,
    subscription_state: null,
    subscription_cancels_at: null,
    subscription_resubscribe_url: null,
    subscription_context_updated_at: null,
    ...overrides,
  };
}

function mockFetch(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new Error('no body');
        return body;
      },
      text: async () => '',
    })),
  );
}

describe('applianceLicenseCheckInActivity', () => {
  beforeEach(() => {
    db.row = row();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('no-ops without a row or connected credential', async () => {
    db.row = null;
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('not_self_host');
    db.row = row({ appliance_credential: null });
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('not_connected');
  });

  it('legacy ok (no subscription): stores the token, no context', async () => {
    mockFetch(200, { status: 'ok', jwt: NEW_TOKEN, exp: 123 });
    expect(await applianceLicenseCheckInActivity()).toEqual({ outcome: 'refreshed', exp: 123 });
    expect(db.row!.license_token).toBe(NEW_TOKEN);
    expect(db.row!.subscription_state).toBeNull();
    expect(db.row!.last_checkin_at).toBeInstanceOf(Date);
  });

  it('ok with an unchanged token is "unchanged"', async () => {
    mockFetch(200, { status: 'ok', jwt: OLD_TOKEN, exp: 123 });
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('unchanged');
  });

  it('cancel_scheduled is recorded alongside the fresh token', async () => {
    mockFetch(200, {
      status: 'ok', jwt: NEW_TOKEN, exp: 123,
      subscription: { state: 'cancel_scheduled', cancels_at: '2030-02-01T00:00:00Z', resubscribe_url: 'https://portal.example/r' },
    });
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('refreshed');
    expect(db.row).toMatchObject({
      license_token: NEW_TOKEN,
      subscription_state: 'cancel_scheduled',
      subscription_cancels_at: new Date('2030-02-01T00:00:00Z'),
      subscription_resubscribe_url: 'https://portal.example/r',
    });
  });

  it('revoked: records the lapse, keeps the stored token (grace)', async () => {
    mockFetch(200, { status: 'revoked', subscription: { state: 'cancelled', resubscribe_url: 'https://portal.example/r' } });
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('revoked');
    expect(db.row!.license_token).toBe(OLD_TOKEN);
    expect(db.row!.subscription_state).toBe('cancelled');
    expect(db.row!.subscription_resubscribe_url).toBe('https://portal.example/r');
  });

  it('legacy bare revoked still records the lapse', async () => {
    mockFetch(200, { status: 'revoked' });
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('revoked');
    expect(db.row!.subscription_state).toBe('cancelled');
    expect(db.row!.license_token).toBe(OLD_TOKEN);
  });

  it('ok after a cancel clears the context', async () => {
    db.row = row({ subscription_state: 'cancelled', subscription_resubscribe_url: 'https://portal.example/r' });
    mockFetch(200, { status: 'ok', jwt: NEW_TOKEN, exp: 123, subscription: { state: 'active' } });
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('refreshed');
    expect(db.row).toMatchObject({
      license_token: NEW_TOKEN,
      subscription_state: null,
      subscription_resubscribe_url: null,
      subscription_cancels_at: null,
    });
  });

  it('401 revoked_appliance → credential_revoked, nothing written', async () => {
    mockFetch(401, { code: 'revoked_appliance' });
    const result = await applianceLicenseCheckInActivity();
    expect(result.outcome).toBe('credential_revoked');
    expect(db.row).toEqual(row());
  });

  it('other 4xx → error; 5xx throws so Temporal retries', async () => {
    mockFetch(404, {});
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('error');
    mockFetch(502, {});
    await expect(applianceLicenseCheckInActivity()).rejects.toThrow(/HTTP 502/);
  });

  it('malformed subscription payload is ignored', async () => {
    mockFetch(200, { status: 'ok', jwt: NEW_TOKEN, exp: 123, subscription: ['x'] });
    expect((await applianceLicenseCheckInActivity()).outcome).toBe('refreshed');
    expect(db.row!.subscription_state).toBeNull();
  });
});
