import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// Passthrough tenantDb so the gate helper's query lands on the fake knex below.
vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

import {
  assertTeamsAddOn,
  getTeamsAddOnState,
  tenantHasTeamsAddOn,
  TeamsAddOnInactiveError,
} from '@alga-psa/ee-microsoft-teams/lib/teams/teamsAddOnGate';

type AddOnRow = { addon_key: string; expires_at: string | Date | null } | null;

// Fake knex that serves both gate queries from a single stored row:
// - tenantHasTeamsAddOn adds an `.andWhere` predicate → we apply the SQL
//   "expires_at IS NULL OR expires_at > now()" filter in JS.
// - getTeamsAddOnState reads the raw row (no predicate) → we return expires_at so
//   the helper can interpret expiry itself.
function makeKnex(getRow: () => AddOnRow) {
  const knex: any = (table: string) => {
    let predicateApplied = false;
    const builder: any = {
      where() {
        return builder;
      },
      andWhere(cb?: (b: any) => void) {
        predicateApplied = true;
        if (cb) {
          cb({
            whereNull() {
              return this;
            },
            orWhere() {
              return this;
            },
          });
        }
        return builder;
      },
      async first(..._cols: string[]) {
        if (table !== 'tenant_addons') {
          throw new Error(`Unexpected table: ${table}`);
        }
        const row = getRow();
        if (!row) {
          return undefined;
        }
        if (predicateApplied) {
          const active = row.expires_at == null || new Date(row.expires_at).getTime() > Date.now();
          return active ? { addon_key: row.addon_key } : undefined;
        }
        return { addon_key: row.addon_key, expires_at: row.expires_at ?? null };
      },
    };
    return builder;
  };
  knex.fn = { now: () => new Date() };
  return knex;
}

const TENANT = '11111111-1111-1111-1111-111111111111';
const past = () => new Date(Date.now() - 86_400_000).toISOString();
const future = () => new Date(Date.now() + 86_400_000).toISOString();

describe('teamsAddOnGate (F063)', () => {
  it('T102: an active row with no expiry resolves active / true and passes assertTeamsAddOn', async () => {
    const knex = makeKnex(() => ({ addon_key: 'teams', expires_at: null }));
    expect(await getTeamsAddOnState(knex, TENANT)).toBe('active');
    expect(await tenantHasTeamsAddOn(knex, TENANT)).toBe(true);
    await expect(assertTeamsAddOn(knex, TENANT)).resolves.toBeUndefined();
  });

  it('T102: an active row with a future expiry resolves active / true', async () => {
    const knex = makeKnex(() => ({ addon_key: 'teams', expires_at: future() }));
    expect(await getTeamsAddOnState(knex, TENANT)).toBe('active');
    expect(await tenantHasTeamsAddOn(knex, TENANT)).toBe(true);
  });

  it('T102: an expired row resolves expired / false — migrated gate sites treat it as inactive', async () => {
    const knex = makeKnex(() => ({ addon_key: 'teams', expires_at: past() }));
    expect(await getTeamsAddOnState(knex, TENANT)).toBe('expired');
    expect(await tenantHasTeamsAddOn(knex, TENANT)).toBe(false);
    await expect(assertTeamsAddOn(knex, TENANT)).rejects.toBeInstanceOf(TeamsAddOnInactiveError);
  });

  it('T102: an absent row resolves absent / false and fails assertTeamsAddOn', async () => {
    const knex = makeKnex(() => null);
    expect(await getTeamsAddOnState(knex, TENANT)).toBe('absent');
    expect(await tenantHasTeamsAddOn(knex, TENANT)).toBe(false);
    await expect(assertTeamsAddOn(knex, TENANT)).rejects.toBeInstanceOf(TeamsAddOnInactiveError);
  });

  it('T102: getTeamsAddOnState === active iff tenantHasTeamsAddOn is true, for every case', async () => {
    const cases: AddOnRow[] = [
      { addon_key: 'teams', expires_at: null },
      { addon_key: 'teams', expires_at: future() },
      { addon_key: 'teams', expires_at: past() },
      null,
    ];
    for (const row of cases) {
      const knex = makeKnex(() => row);
      const state = await getTeamsAddOnState(knex, TENANT);
      const bool = await tenantHasTeamsAddOn(knex, TENANT);
      expect(bool).toBe(state === 'active');
    }
  });

  it('T107: an expired add-on flips back to active after re-activation, no reconfiguration', async () => {
    let row: AddOnRow = { addon_key: 'teams', expires_at: past() };
    const knex = makeKnex(() => row);

    expect(await getTeamsAddOnState(knex, TENANT)).toBe('expired');
    expect(await tenantHasTeamsAddOn(knex, TENANT)).toBe(false);

    // Billing replaces the lapsed row with a fresh, non-expired one. The gate
    // observes the flip immediately with no config change on the Teams side.
    row = { addon_key: 'teams', expires_at: null };

    expect(await getTeamsAddOnState(knex, TENANT)).toBe('active');
    expect(await tenantHasTeamsAddOn(knex, TENANT)).toBe(true);
    await expect(assertTeamsAddOn(knex, TENANT)).resolves.toBeUndefined();
  });

  it('TeamsAddOnInactiveError carries the distinguishing state and the addon_inactive code', async () => {
    const expiredKnex = makeKnex(() => ({ addon_key: 'teams', expires_at: past() }));
    await expect(assertTeamsAddOn(expiredKnex, TENANT)).rejects.toMatchObject({
      code: 'addon_inactive',
      state: 'expired',
    });

    const absentKnex = makeKnex(() => null);
    await expect(assertTeamsAddOn(absentKnex, TENANT)).rejects.toMatchObject({
      code: 'addon_inactive',
      state: 'absent',
    });
  });
});
