/**
 * L1a layer: relationship, provisioning and acceptance.
 *
 * Oz holds an unsigned `admin_grant` entitlement (no Stripe, no signed licence)
 * of five seats, and has two disposable clients with NO relationship, so the
 * Enable flow is exercised live (one is enabled, the other enabled then
 * cancelled). Kansas and Emerald are the base tenants and get nothing here:
 * Kansas has no entitlement and the flag off, Emerald the flag on, no
 * entitlement and no relationship.
 */
import type { Knex } from 'knex';
import { CREATED, VALID_UNTIL, configuredDefaultCurrency, id, put, type FixtureModule, type VerifyReport } from './shared';
import { EMERALD, KANSAS, OZ } from './base';

export const L1A_ENTITLEMENT_REFERENCE = 'fixture:l1a';
export const L1A_CAPACITY = 5;
export const OZ_ESCALATION_BOARD = id('board/oz/escalations');
export const DISPOSABLE_CLIENTS = [
  { slug: 'disposable-enable', name: 'Disposable Enable Co' },
  { slug: 'disposable-cancel', name: 'Disposable Cancel Co' },
].map(client => ({ ...client, clientId: id(`client/oz/${client.slug}`) }));

/** Tenants a fixture run may leave as `co_managed`: none. Provisioning creates them live. */
export async function strayCoManagedTenants(db: Knex, createdByRun: readonly string[] = []): Promise<string[]> {
  const rows = await db('tenants').where({ product_code: 'co_managed' }).select('tenant');
  return rows.map((row: { tenant: string }) => row.tenant).filter(tenant => !createdByRun.includes(tenant));
}

export const l1aModule: FixtureModule = {
  name: 'L1a',
  requires: ['base'],
  async apply(trx) {
    await put(trx, 'boards', ['tenant', 'board_id'], {
      tenant: OZ, board_id: OZ_ESCALATION_BOARD, board_name: 'Escalations', is_inactive: false,
    });
    await put(trx, 'co_managed_entitlements', ['tenant'], {
      tenant: OZ, source: 'admin_grant', source_reference: L1A_ENTITLEMENT_REFERENCE, capacity: L1A_CAPACITY,
      signed_license: null, verified_at: CREATED, valid_until: VALID_UNTIL,
      lapse_started_at: null, read_only_after: null, updated_at: CREATED,
    });
    const currency = await configuredDefaultCurrency(trx, OZ);
    for (const client of DISPOSABLE_CLIENTS) {
      await put(trx, 'clients', ['tenant', 'client_id'], {
        tenant: OZ, client_id: client.clientId, client_name: client.name, client_type: 'company',
        is_inactive: false, is_tax_exempt: false, billing_cycle: 'monthly',
        ...(currency ? { default_currency_code: currency } : {}),
        lifecycle_status: 'active', created_at: CREATED, updated_at: CREATED,
      });
    }
  },
  async verify(db) {
    const reports: VerifyReport[] = [];
    const board = await db('boards').where({ tenant: OZ, board_id: OZ_ESCALATION_BOARD, is_inactive: false }).first('board_id');
    reports.push({ ok: !!board, area: 'L1a', detail: 'Oz has an active escalation board' });
    const entitlements = await db('co_managed_entitlements').where({ tenant: OZ });
    const grant = entitlements[0];
    reports.push({
      ok: entitlements.length === 1 && grant.source === 'admin_grant' && grant.source_reference === L1A_ENTITLEMENT_REFERENCE
        && Number(grant.capacity) === L1A_CAPACITY && grant.signed_license == null,
      area: 'L1a', detail: `exactly one Oz admin_grant entitlement of ${L1A_CAPACITY} seats, unsigned (found ${entitlements.length})`,
    });
    for (const client of DISPOSABLE_CLIENTS) {
      const live = await db('co_managed_provisioning_operations as o')
        .join('co_managed_allocations as a', function () {
          this.on('a.tenant', 'o.tenant').andOn('a.allocation_id', 'o.allocation_id');
        })
        .where('o.tenant', OZ).whereRaw("lower(o.request->>'clientId') = lower(?)", [client.clientId])
        .whereNot('a.state', 'released').count<{ count: string }[]>('* as count');
      const relationships = await db('co_management_relationships')
        .where({ sponsor_tenant: OZ, sponsor_client_id: client.clientId }).whereNull('ended_at').count<{ count: string }[]>('* as count');
      const liveCount = Number(live[0]?.count ?? 0) + Number(relationships[0]?.count ?? 0);
      reports.push({ ok: liveCount === 0, area: 'L1a',
        detail: `${client.slug} has no live allocation or relationship (found ${liveCount})` });
    }
    // Kansas and Emerald hold no co-managed state at all.
    for (const [label, tenant] of [['Kansas', KANSAS], ['Emerald', EMERALD]] as const) {
      const rows = await db('co_managed_entitlements').where({ tenant }).count<{ count: string }[]>('* as count');
      const relationships = await db('co_management_relationships')
        .where(function () { this.where({ tenant }).orWhere({ sponsor_tenant: tenant }); }).count<{ count: string }[]>('* as count');
      const count = Number(rows[0]?.count ?? 0) + Number(relationships[0]?.count ?? 0);
      reports.push({ ok: count === 0, area: 'L1a', detail: `${label} has no entitlement or relationship (found ${count})` });
    }
    const stray = await strayCoManagedTenants(db);
    reports.push({ ok: stray.length === 0, area: 'L1a',
      detail: `no co_managed tenant besides those this run created -- it creates none (found ${stray.length})` });
    return reports;
  },
  async reset(trx) {
    await trx('boards').where({ tenant: OZ, board_id: OZ_ESCALATION_BOARD }).delete();
    await trx('co_managed_entitlements')
      .where({ tenant: OZ, source: 'admin_grant', source_reference: L1A_ENTITLEMENT_REFERENCE }).delete();
    for (const client of DISPOSABLE_CLIENTS) {
      await trx('clients').where({ tenant: OZ, client_id: client.clientId }).delete();
    }
  },
};
