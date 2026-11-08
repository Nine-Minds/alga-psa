// Run from the repository root against the citus-test sandbox only.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = process.cwd();
const knex = require(path.join(root, 'node_modules/knex'));
const pod = process.env.CITUS_TEST_POD;
if (!pod) throw new Error('Set CITUS_TEST_POD to the sandbox coordinator pod and forward its port first.');
const password = execFileSync('kubectl', ['-n', 'citus-test', 'exec', pod, '--', 'printenv', 'POSTGRES_PASSWORD'], {encoding:'utf8'}).trim();
const conn = {host:'127.0.0.1', port:Number(process.env.CITUS_TEST_PORT || 55483), user:'postgres', password};
const dbName = `test_invoice_adjustment_${process.pid}`;
const admin = knex({client:'pg', connection:{...conn, database:'postgres'}});
const migration = require(path.join(root,'server/migrations/20260927050000_track_contract_template_discount_copies.cjs'));
const repair = require(path.join(root,'server/migrations/20260927070000_distribute_contract_template_discount_copies.cjs'));
(async () => {
 let db;
 try {
  await admin.raw(`CREATE DATABASE ${dbName}`);
  db=knex({client:'pg', connection:{...conn,database:dbName}});
  await db.raw('CREATE EXTENSION citus');
  await db.raw("SELECT citus_set_coordinator_host('localhost', 5432)");
  await db.raw("SELECT citus_set_node_property('localhost', 5432, 'shouldhaveshards', true)");
  await db.raw('SET citus.shard_replication_factor = 1');
  await db.raw('SET citus.shard_count = 2');
  for (const [table,id] of [['client_contracts','client_contract_id'], ['discounts','discount_id']]) {
    await db.schema.createTable(table,t=>{t.uuid('tenant').notNullable();t.uuid(id).notNullable();t.primary(['tenant',id]);});
    await db.raw(`SELECT create_distributed_table('${table}', 'tenant')`);
  }
  await db.schema.createTable('tenants',t=>{t.uuid('tenant').primary();});
  await db.raw("SELECT create_reference_table('tenants')");
  await db.schema.createTable('contracts',t=>{t.uuid('tenant').notNullable();t.uuid('contract_id').notNullable();t.primary(['tenant','contract_id']);});
  await db.raw("SELECT create_distributed_table('contracts', 'tenant')");
  await db.transaction(trx=>require(path.join(root,'server/migrations/20260927010000_add_contract_discount_assignments.cjs')).up(trx));
  console.log('Citus contract assignment migration: PASS');
  await db.transaction(trx=>require(path.join(root,'server/migrations/20260927020000_scope_contract_discount_assignments_to_client_contracts.cjs')).up(trx));
  await db.transaction(trx=>require(path.join(root,'server/migrations/20260927010000_add_contract_discount_assignments.cjs')).up(trx));
  console.log('Citus client ownership migration and assignment rerun: PASS');
  const tenant='11111111-1111-4111-8111-111111111111';
  const owner='22222222-2222-4222-8222-222222222222';
  const discount='33333333-3333-4333-8333-333333333333';
  await db('client_contracts').insert({tenant,client_contract_id:owner});
  await db('discounts').insert({tenant,discount_id:discount});
  await db.transaction(trx=>migration.up(trx));
  await db('contract_template_discount_copies').insert({tenant,client_contract_id:owner,discount_id:discount,template_discount_key:'term'});
  await db.transaction(trx=>repair.up(trx));
  await db.transaction(trx=>migration.up(trx));
  assert.equal((await db('contract_template_discount_copies')).length,1);
  const {rows} = await db.raw("SELECT p.colocationid = c.colocationid AS colocated FROM pg_dist_partition p JOIN pg_dist_partition c ON c.logicalrelid='client_contracts'::regclass WHERE p.logicalrelid='contract_template_discount_copies'::regclass");
  assert.equal(rows[0].colocated,true);
  await db('client_contracts').where({tenant,client_contract_id:owner}).delete();
  assert.equal((await db('contract_template_discount_copies')).length,0);
  console.log('Citus fresh migration, populated reruns, colocation and cascade: PASS');
  // Simulate the earlier table shape on an already-distributed installation.
  await db.schema.dropTable('contract_template_discount_copies');
  await db.schema.createTable('contract_template_discount_copies',t=>{t.uuid('tenant').notNullable();t.uuid('client_contract_id').notNullable();t.uuid('discount_id').notNullable();t.string('template_discount_key',200).notNullable();t.primary(['tenant','client_contract_id','template_discount_key']);t.unique(['tenant','discount_id']);});
  await db('client_contracts').insert({tenant,client_contract_id:owner});
  await db('contract_template_discount_copies').insert({tenant,client_contract_id:owner,discount_id:discount,template_discount_key:'term'});
  await db.transaction(trx=>repair.up(trx));
  assert.equal((await db('contract_template_discount_copies')).length,1);
  await db('discounts').where({tenant,discount_id:discount}).delete();
  assert.equal((await db('contract_template_discount_copies')).length,0);
  console.log('Citus populated local-table upgrade and discount cascade: PASS');
 } finally {
   if(db) {await db.destroy();await admin.raw(`DROP DATABASE ${dbName} WITH (FORCE)`);}
   await admin.destroy();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
