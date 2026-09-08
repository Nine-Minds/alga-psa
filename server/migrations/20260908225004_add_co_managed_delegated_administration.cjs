const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const GRANTS = 'co_management_delegated_grants', RECEIPTS = 'co_management_delegated_receipts';
exports.up = async knex => {
  if (!await knex.schema.hasTable(GRANTS)) await knex.schema.createTable(GRANTS, t => {
    t.uuid('tenant').notNullable(); t.uuid('grant_id').notNullable(); t.uuid('relationship_id').notNullable();
    t.text('principal_type').notNullable(); t.uuid('principal_id').notNullable(); t.text('operation').notNullable(); t.uuid('target_id').notNullable();
    t.text('target_fingerprint').nullable(); t.uuid('approved_by').notNullable(); t.integer('approved_revision').notNullable();
    t.timestamp('revoked_at', { useTz: true }).nullable(); t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'grant_id']);
    t.check("principal_type IN ('user','team')"); t.check("operation IN ('board_settings','user_profile','invitation_resend')");
  });
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_delegated_active_scope ON co_management_delegated_grants
    (tenant, relationship_id, principal_type, principal_id, operation, target_id) WHERE revoked_at IS NULL`);
  if (!await knex.schema.hasTable(RECEIPTS)) await knex.schema.createTable(RECEIPTS, t => {
    t.uuid('tenant').notNullable(); t.uuid('operation_id').notNullable(); t.uuid('grant_id').notNullable(); t.text('request_fingerprint').notNullable();
    t.uuid('actor_tenant').notNullable(); t.uuid('actor_user_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()); t.primary(['tenant','operation_id']);
  });
  for (const table of [GRANTS, RECEIPTS]) await ensureTenantDistribution(knex, table);
  for (const [table, name, cols, parent, refs] of [
    [GRANTS, 'co_delegated_relationship_fk', ['tenant','relationship_id'], 'co_management_relationships', ['tenant','relationship_id']],
    [RECEIPTS, 'co_delegated_receipt_grant_fk', ['tenant','grant_id'], GRANTS, ['tenant','grant_id']],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [table]).first()) {
    await knex.schema.alterTable(table, t => t.foreign(cols, name).references(refs).inTable(parent).onDelete('CASCADE'));
  }
  await knex.raw(`CREATE OR REPLACE FUNCTION co_delegated_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'Delegated administration receipts are immutable' USING ERRCODE = '23514'; END; $$`);
  await knex.raw('DROP TRIGGER IF EXISTS co_delegated_receipt_immutable ON co_management_delegated_receipts');
  await knex.raw('CREATE TRIGGER co_delegated_receipt_immutable BEFORE UPDATE ON co_management_delegated_receipts FOR EACH ROW EXECUTE FUNCTION co_delegated_receipt_immutable()');
};
exports.down = async knex => {
  for (const table of [GRANTS,RECEIPTS]) if (await knex(table).first()) throw new Error('Cannot discard delegated administration history');
  await knex.schema.dropTable(RECEIPTS); await knex.schema.dropTable(GRANTS); await knex.raw('DROP FUNCTION IF EXISTS co_delegated_receipt_immutable()');
};
exports.config = { transaction: false };
