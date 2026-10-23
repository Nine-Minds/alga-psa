/* Run only against a disposable, empty Citus database named pr3499_citus_discounts.
 * PR3499_CITUS_DATABASE_URL=postgres://.../pr3499_citus_discounts node scripts/check-pr3499-citus-discount-migration.cjs
 * Configure the coordinator as a shard-hosting node before running. All fixture
 * schema/data changes roll back, including migration distribution and reruns.
 */
const assert = require('node:assert/strict');
const knex = require('knex');
const migration = require('../server/migrations/20260927010000_add_contract_discount_assignments.cjs');
const url = process.env.PR3499_CITUS_DATABASE_URL;
if (!url || new URL(url).pathname !== '/pr3499_citus_discounts') {
  throw new Error('Set PR3499_CITUS_DATABASE_URL to a disposable pr3499_citus_discounts database');
}
const db = knex({ client: 'pg', connection: url });
const rollback = new Error('rollback disposable fixture');
(async () => {
  assert.equal((await db.raw("SELECT current_database() AS name")).rows[0].name, 'pr3499_citus_discounts');
  assert.equal((await db.raw("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows[0].count, 0, 'Database must be empty');
  await assert.rejects(db.transaction(async (trx) => {
    await trx.raw('CREATE TABLE tenants (tenant uuid PRIMARY KEY)');
    await trx.raw("SELECT create_reference_table('tenants')");
    await trx.raw('CREATE TABLE contracts (tenant uuid NOT NULL REFERENCES tenants(tenant), contract_id uuid NOT NULL, PRIMARY KEY(tenant, contract_id))');
    await trx.raw("SELECT create_distributed_table('contracts', 'tenant')");
    await trx.raw('CREATE TABLE discounts (tenant uuid NOT NULL REFERENCES tenants(tenant), discount_id uuid NOT NULL, PRIMARY KEY(tenant, discount_id))');
    const tenant = '00000000-0000-4000-8000-000000000001';
    const contract = '00000000-0000-4000-8000-000000000002';
    const discount = '00000000-0000-4000-8000-000000000003';
    await trx('tenants').insert({ tenant });
    await trx('contracts').insert({ tenant, contract_id: contract });
    await trx('discounts').insert({ tenant, discount_id: discount });
    await migration.up(trx);
    await trx('contract_discount_assignments').insert({ tenant, assignment_id: '00000000-0000-4000-8000-000000000004', contract_id: contract, discount_id: discount });
    await migration.up(trx);
    assert.equal((await trx('contract_discount_assignments')).length, 1);
    assert.equal((await trx('discounts')).length, 1);
    const distribution = await trx.raw("SELECT count(DISTINCT colocationid)::int AS count FROM pg_dist_partition WHERE logicalrelid IN ('contracts'::regclass, 'discounts'::regclass, 'contract_discount_assignments'::regclass)");
    assert.equal(distribution.rows[0].count, 1);
    await trx('discounts').where({ tenant, discount_id: discount }).delete();
    assert.equal((await trx('contract_discount_assignments')).length, 0);
    throw rollback;
  }), (error) => error === rollback);
  console.log('PASS: populated local discount parent, distribution, preserved identities, rerun, and FK cascade');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.destroy());
