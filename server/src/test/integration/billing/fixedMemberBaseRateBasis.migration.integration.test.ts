import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestService } from '../../../../test-utils/billingTestHelpers';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';

/**
 * Migration 20261012000001_fixed_member_base_rate_basis (plan §4, §5.6):
 *   - classification of the four line shapes
 *   - constraints: a rate with no basis fails; a 'unit' row labelled 'share' fails
 *
 * createTestDbConnection() has already migrated to head, so the test rewinds
 * the column (down) and re-applies the migration over seeded legacy data.
 */

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../../../../migrations/20261012000001_fixed_member_base_rate_basis.cjs'));

let db: Knex;
let tenant: string;

async function seedService(name: string): Promise<string> {
  return createTestService({ db, tenantId: tenant } as any, {
    service_name: name,
    billing_method: 'fixed',
    default_rate: 0,
    unit_of_measure: 'seat',
  });
}

async function seedLine(lineRate: number | null): Promise<string> {
  const lineId = uuidv4();
  await db('contract_lines').insert({
    tenant, contract_line_id: lineId, contract_line_name: `Line ${lineId.slice(0, 6)}`,
    billing_frequency: 'monthly', is_custom: true, contract_line_type: 'Fixed',
    is_template: false, custom_rate: lineRate, rate_provenance: lineRate === null ? 'inherited' : 'custom',
  });
  return lineId;
}

async function seedMember(opts: {
  lineId: string;
  serviceId: string;
  qty: number;
  baseRate?: number | null;
  configCustomRate?: number | null;
  pricingBasis?: string | null;
}): Promise<string> {
  const configId = uuidv4();
  await db('contract_line_services').insert({
    tenant, contract_line_id: opts.lineId, service_id: opts.serviceId, quantity: opts.qty,
  });
  await db('contract_line_service_configuration').insert({
    tenant, config_id: configId, contract_line_id: opts.lineId, service_id: opts.serviceId,
    configuration_type: 'Fixed', quantity: opts.qty, custom_rate: opts.configCustomRate ?? null,
  });
  if (opts.baseRate != null || opts.pricingBasis) {
    await db('contract_line_service_fixed_config').insert({
      tenant, config_id: configId, base_rate: opts.baseRate ?? null,
      pricing_basis: opts.pricingBasis ?? null,
      rate_provenance: opts.baseRate != null ? 'custom' : 'inherited',
    });
  }
  return configId;
}

const basisOf = async (configId: string) =>
  (await db('contract_line_service_fixed_config').where({ tenant, config_id: configId }).first())?.base_rate_basis;

describe('fixed member base_rate_basis migration', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    // Reuse the seeded tenant: it owns the standard service types that createTestService needs.
    tenant = (await db('tenants').first('tenant')).tenant;
    await migration.down(db);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('classifies the four shapes (and seats) and enforces the constraints', async () => {
    // Sequential: concurrent createTestService calls race on the shared service type.
    const seeded: string[] = [];
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) seeded.push(await seedService(`Basis ${n}`));
    const [a, b, c, d, e, f, g] = seeded;

    // Shape 1: wizard share line WITH a line rate (225/675 at q1/q3, line 900).
    const wizardLine = await seedLine(900);
    const w1 = await seedMember({ lineId: wizardLine, serviceId: a, qty: 1, baseRate: 225, pricingBasis: 'bundle' });
    const w2 = await seedMember({ lineId: wizardLine, serviceId: b, qty: 3, baseRate: 675, pricingBasis: 'bundle' });

    // Shape 2: wizard share line made inherited (shares left behind, no line rate).
    const inheritedShareLine = await seedLine(null);
    const s1 = await seedMember({ lineId: inheritedShareLine, serviceId: a, qty: 1, baseRate: 225, pricingBasis: 'bundle' });
    const s2 = await seedMember({ lineId: inheritedShareLine, serviceId: b, qty: 3, baseRate: 675, pricingBasis: 'bundle' });

    // Shape 3: per-unit inherited line (225 each at q1/q3).
    const perUnitLine = await seedLine(null);
    const p1 = await seedMember({ lineId: perUnitLine, serviceId: a, qty: 1, baseRate: 225, pricingBasis: 'bundle' });
    const p2 = await seedMember({ lineId: perUnitLine, serviceId: b, qty: 3, baseRate: 225, pricingBasis: 'bundle' });

    // Shape 4: ambiguous equal-quantity (2/2) share-shaped line, no line rate.
    const ambiguousLine = await seedLine(null);
    const m1 = await seedMember({ lineId: ambiguousLine, serviceId: c, qty: 2, baseRate: 500, pricingBasis: 'bundle' });
    const m2 = await seedMember({ lineId: ambiguousLine, serviceId: d, qty: 2, baseRate: 500, pricingBasis: 'bundle' });

    // Seat.
    const seatLine = await seedLine(null);
    const seat = await seedMember({ lineId: seatLine, serviceId: e, qty: 4, baseRate: 1500, pricingBasis: 'unit' });

    await migration.up(db);

    expect(await basisOf(w1)).toBe('share');
    expect(await basisOf(w2)).toBe('share');
    expect(await basisOf(s1)).toBe('share');
    expect(await basisOf(s2)).toBe('share');
    expect(await basisOf(p1)).toBe('per_unit');
    expect(await basisOf(p2)).toBe('per_unit');
    expect(await basisOf(m1)).toBe('per_unit');
    expect(await basisOf(m2)).toBe('per_unit');
    expect(await basisOf(seat)).toBe('per_unit');

    // Constraints.
    const extraConfig = await seedMember({ lineId: ambiguousLine, serviceId: await seedService('Basis H'), qty: 1 });
    await expect(
      db('contract_line_service_fixed_config').insert({
        tenant, config_id: extraConfig, base_rate: 100, rate_provenance: 'custom', pricing_basis: 'bundle',
      }),
    ).rejects.toThrow(/base_rate_basis_rate_check/);
    const seatConfig = await seedMember({ lineId: seatLine, serviceId: await seedService('Basis I'), qty: 1 });
    await expect(
      db('contract_line_service_fixed_config').insert({
        tenant, config_id: seatConfig, base_rate: 100, rate_provenance: 'custom',
        pricing_basis: 'unit', base_rate_basis: 'share',
      }),
    ).rejects.toThrow(/base_rate_basis_seat_check/);
  }, 180_000);
});
