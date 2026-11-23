/**
 * T216 — F124 of `ee/plans/2026-11-21-itil-remediation` (`sla`).
 *
 * `sla_policies.is_itil_standard` replaces the name match the ITIL SLA code used. The migration
 * flags the row named 'ITIL Standard' and nothing else, allows at most one per tenant, and assigns
 * no board an SLA it did not have (D1).
 *
 * Fixture schema, as the other migration suites here: only the tables the migration touches.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const MIGRATION = '20261123090000_flag_itil_standard_sla_policy.cjs';
const migrationsRoot = path.resolve(__dirname, '..');

const FIXTURE_SQL = `
  CREATE TABLE tenants (tenant uuid PRIMARY KEY);
  CREATE TABLE sla_policies (tenant uuid, sla_policy_id uuid, policy_name text NOT NULL,
    description text, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now(),
    PRIMARY KEY (tenant, sla_policy_id));
  CREATE TABLE boards (tenant uuid, board_id uuid, board_name text, sla_policy_id uuid,
    PRIMARY KEY (tenant, board_id));
`;

const DISTRIBUTED = ['sla_policies', 'boards'];

describe('ITIL SLA policy flag migration', () => {
  let db: Knex;
  let scratch: string;
  const tenants = new Set<string>();

  beforeAll(async () => {
    wireLocalTestDbEnv();
    scratch = mkdtempSync(path.join(tmpdir(), 'itil-sla-policy-flag-'));
    writeFileSync(
      path.join(scratch, '20261123000000_fixture.cjs'),
      `
      exports.config = { transaction: false };
      exports.up = async (knex) => {
        await knex.raw(${JSON.stringify(FIXTURE_SQL)});
        if (process.env.TEST_DB_BACKEND === 'citus') {
          await knex.raw("SELECT create_distributed_table('tenants', 'tenant')");
          for (const table of ${JSON.stringify(DISTRIBUTED)}) {
            await knex.raw("SELECT create_distributed_table(?, 'tenant', colocate_with => 'tenants')", [table]);
          }
        }
      };
      exports.down = async () => {};
    `
    );
    writeFileSync(
      path.join(scratch, MIGRATION),
      `module.exports = require(${JSON.stringify(path.join(migrationsRoot, MIGRATION))});\n`
    );

    db = await createTestDbConnection({
      databaseName: 'itil_sla_policy_flag_migration_test',
      migrationsDir: scratch,
      runSeeds: false,
    });
    await down();
  }, 300_000);

  afterAll(async () => {
    try {
      await db?.destroy();
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    await down();
    for (const tenant of tenants) {
      for (const table of [...DISTRIBUTED, 'tenants']) {
        await db(table).where({ tenant }).del();
      }
    }
    tenants.clear();
  });

  let applied = true;
  const up = async () => {
    if (applied) return;
    await db.migrate.up({ name: MIGRATION });
    applied = true;
  };
  const down = async () => {
    if (!applied) return;
    await db.migrate.down({ name: MIGRATION });
    applied = false;
  };

  async function newTenant(): Promise<string> {
    const tenant = randomUUID();
    tenants.add(tenant);
    await db('tenants').insert({ tenant });
    return tenant;
  }

  async function addPolicy(tenant: string, policyName: string, createdAt?: string): Promise<string> {
    const slaPolicyId = randomUUID();
    await db('sla_policies').insert({
      tenant,
      sla_policy_id: slaPolicyId,
      policy_name: policyName,
      ...(createdAt ? { created_at: createdAt } : {}),
    });
    return slaPolicyId;
  }

  it('T216: flags the policy named ITIL Standard and no other', async () => {
    const tenant = await newTenant();
    const itilPolicy = await addPolicy(tenant, 'ITIL Standard');
    const ownPolicy = await addPolicy(tenant, 'Gold support');
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: 'Support', sla_policy_id: null });

    await up();

    const flagged = await db('sla_policies').where({ tenant, is_itil_standard: true }).pluck('sla_policy_id');
    expect(flagged).toEqual([itilPolicy]);
    expect(
      (await db('sla_policies').where({ tenant, sla_policy_id: ownPolicy }).first('is_itil_standard'))
        .is_itil_standard
    ).toBe(false);
    // D1: no board gained an SLA policy.
    expect((await db('boards').where({ tenant, board_id: boardId }).first('sla_policy_id')).sla_policy_id).toBeNull();
  }, 120_000);

  it('T216: a tenant with several such rows keeps the oldest as the ITIL one', async () => {
    const tenant = await newTenant();
    const older = await addPolicy(tenant, 'ITIL Standard', '2026-01-01T00:00:00.000Z');
    const newer = await addPolicy(tenant, 'ITIL Standard', '2026-06-01T00:00:00.000Z');

    await up();

    const flagged = await db('sla_policies').where({ tenant, is_itil_standard: true }).pluck('sla_policy_id');
    expect(flagged).toEqual([older]);
    expect(
      (await db('sla_policies').where({ tenant, sla_policy_id: newer }).first('is_itil_standard')).is_itil_standard
    ).toBe(false);
  }, 120_000);

  it('T216: a second flagged policy in a tenant is rejected', async () => {
    const tenant = await newTenant();
    await addPolicy(tenant, 'ITIL Standard');
    await up();

    const intruder = randomUUID();
    await expect(
      db('sla_policies').insert({
        tenant,
        sla_policy_id: intruder,
        policy_name: 'Another ITIL policy',
        is_itil_standard: true,
      })
    ).rejects.toThrow(/unique/i);

    // Two tenants may each have one.
    const otherTenant = await newTenant();
    await db('sla_policies').insert({
      tenant: otherTenant,
      sla_policy_id: randomUUID(),
      policy_name: 'ITIL Standard',
      is_itil_standard: true,
    });
    expect(await db('sla_policies').where({ is_itil_standard: true }).count('* as n').first()).toMatchObject({
      n: '2',
    });
  }, 120_000);

  it('T216: a tenant with no such policy gets none, and a re-run changes nothing', async () => {
    const tenant = await newTenant();
    await addPolicy(tenant, 'Standard support');

    await up();
    expect(await db('sla_policies').where({ tenant, is_itil_standard: true })).toHaveLength(0);

    // Idempotent: running the migration again finds the flag settled and writes nothing.
    const before = await db('sla_policies').where({ tenant }).orderBy('sla_policy_id').select('*');
    await db.migrate.down({ name: MIGRATION });
    await db.migrate.up({ name: MIGRATION });
    const after = await db('sla_policies').where({ tenant }).orderBy('sla_policy_id').select('*');
    expect(after).toEqual(before);
  }, 120_000);

  it('T216: down() removes the flag and the index', async () => {
    const tenant = await newTenant();
    await addPolicy(tenant, 'ITIL Standard');
    await up();
    expect(await db('sla_policies').where({ tenant, is_itil_standard: true })).toHaveLength(1);

    await down();
    const columns = await db('sla_policies').columnInfo();
    expect(Object.keys(columns)).not.toContain('is_itil_standard');
  }, 120_000);
});
