import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Entitlement is deny-by-default and the expiry predicate runs in SQL so it uses
 * the database clock; the fake below keeps that shape (a sub-builder with
 * whereNull OR expires_at > now) rather than filtering in JS after the fact.
 */
const fixtures = vi.hoisted(() => ({ addons: [] as Array<Record<string, unknown>> }));

vi.mock('@alga-psa/db', () => {
  const build = (rows: Array<Record<string, unknown>>, tenant: string) => {
    const predicates: Array<(row: any) => boolean> = [(row) => row.tenant === tenant];
    const builder: any = {
      where(conditions: Record<string, unknown>) {
        predicates.push((row) => Object.entries(conditions).every(([key, value]) => row[key] === value));
        return builder;
      },
      andWhere(callback: (sub: any) => void) {
        const clauses: Array<(row: any) => boolean> = [];
        const sub: any = {
          whereNull(column: string) {
            clauses.push((row) => row[column] == null);
            return sub;
          },
          orWhere(column: string, _operator: string, value: unknown) {
            clauses.push((row) => row[column] != null && new Date(row[column]).getTime() > Number(value));
            return sub;
          },
        };
        callback(sub);
        predicates.push((row) => clauses.some((fn) => fn(row)));
        return builder;
      },
      async first() {
        return rows.find((row) => predicates.every((fn) => fn(row)));
      },
    };
    return builder;
  };

  return {
    tenantDb: (_knex: any, tenant: string) => ({
      table: (name: string) => build(name === 'tenant_addons' ? fixtures.addons : [], tenant),
    }),
  };
});

import { assertTelephonyAddOn, tenantHasTelephonyAddOn, TelephonyAddOnInactiveError } from './telephonyAddOnGate';

// `knex.fn.now()` stands in for the database clock.
const knex: any = { fn: { now: () => Date.now() } };

describe('tenantHasTelephonyAddOn', () => {
  beforeEach(() => {
    fixtures.addons.length = 0;
  });

  it('T002: a tenant with no add-on row is denied', async () => {
    await expect(tenantHasTelephonyAddOn(knex, 't1')).resolves.toBe(false);
  });

  it('T002: an add-on with no expiry is active', async () => {
    fixtures.addons.push({ tenant: 't1', addon_key: 'telephony', expires_at: null });

    await expect(tenantHasTelephonyAddOn(knex, 't1')).resolves.toBe(true);
  });

  it('T002: an add-on that has not expired yet is active', async () => {
    fixtures.addons.push({
      tenant: 't1',
      addon_key: 'telephony',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await expect(tenantHasTelephonyAddOn(knex, 't1')).resolves.toBe(true);
  });

  it('T002: an expired add-on is denied', async () => {
    fixtures.addons.push({
      tenant: 't1',
      addon_key: 'telephony',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(tenantHasTelephonyAddOn(knex, 't1')).resolves.toBe(false);
  });

  it('T002: another add-on does not entitle telephony', async () => {
    fixtures.addons.push({ tenant: 't1', addon_key: 'teams', expires_at: null });

    await expect(tenantHasTelephonyAddOn(knex, 't1')).resolves.toBe(false);
  });

  it('T002: entitlement never leaks across tenants', async () => {
    fixtures.addons.push({ tenant: 't2', addon_key: 'telephony', expires_at: null });

    await expect(tenantHasTelephonyAddOn(knex, 't1')).resolves.toBe(false);
  });

  it('T002: assertTelephonyAddOn throws a typed error for an unentitled tenant', async () => {
    await expect(assertTelephonyAddOn(knex, 't1')).rejects.toBeInstanceOf(TelephonyAddOnInactiveError);

    fixtures.addons.push({ tenant: 't1', addon_key: 'telephony', expires_at: null });
    await expect(assertTelephonyAddOn(knex, 't1')).resolves.toBeUndefined();
  });
});
