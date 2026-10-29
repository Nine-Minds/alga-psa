/**
 * Co-managed IT L2: delegated administration grants and receipts (new tables).
 *
 * No foreign keys, no triggers: receipt immutability is enforced in app code.
 * Grants are versioned via `revision`; `approved_revision` records the
 * relationship revision at approval. Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const GRANTS = 'co_management_delegated_grants';
const RECEIPTS = 'co_management_delegated_receipts';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(GRANTS))) {
    await knex.schema.createTable(GRANTS, (t) => {
      t.uuid('tenant').notNullable();
      t.uuid('grant_id').notNullable();
      t.uuid('relationship_id').notNullable();
      t.text('principal_type').notNullable();
      t.uuid('principal_id').notNullable();
      t.text('operation').notNullable();
      t.uuid('target_id').notNullable();
      t.text('target_fingerprint').nullable();
      t.uuid('approved_by').notNullable();
      t.integer('approved_revision').notNullable();
      t.integer('revision').notNullable().defaultTo(1);
      t.timestamp('revoked_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['tenant', 'grant_id']);
      t.check("principal_type IN ('user','team')");
      t.check("operation IN ('board_settings','user_profile','invitation_resend')");
      t.check('revision > 0');
    });
  }
  if (await knex.schema.hasTable(GRANTS)) {
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_delegated_active_scope ON ${GRANTS}
      (tenant, relationship_id, principal_type, principal_id, operation, target_id) WHERE revoked_at IS NULL`);
  }

  if (!(await knex.schema.hasTable(RECEIPTS))) {
    await knex.schema.createTable(RECEIPTS, (t) => {
      t.uuid('tenant').notNullable();
      t.uuid('operation_id').notNullable();
      t.uuid('grant_id').notNullable();
      t.text('request_fingerprint').notNullable();
      t.uuid('actor_tenant').notNullable();
      t.uuid('actor_user_id').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['tenant', 'operation_id']);
    });
  }

  for (const table of [GRANTS, RECEIPTS]) await ensureTenantDistribution(knex, table);
};

exports.down = async function down(knex) {
  for (const table of [GRANTS, RECEIPTS]) {
    if ((await knex.schema.hasTable(table)) && (await knex(table).first())) {
      throw new Error('Cannot discard delegated administration history');
    }
  }
  await knex.schema.dropTableIfExists(RECEIPTS);
  await knex.schema.dropTableIfExists(GRANTS);
};

exports.config = { transaction: false };
