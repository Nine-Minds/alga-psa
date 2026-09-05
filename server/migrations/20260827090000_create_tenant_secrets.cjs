const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  await knex.schema.createTable('tenant_secrets', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.text('description').nullable();
    t.text('secret_provider_key').notNullable();
    t.uuid('created_by').notNullable();
    t.uuid('updated_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_accessed_at', { useTz: true }).nullable();
    t.primary(['tenant', 'id']);
    t.unique(['tenant', 'name'], { indexName: 'uq_tenant_secrets_name' });
    t.index(['tenant', 'name'], 'idx_tenant_secrets_name');
  });
  await ensureTenantDistribution(knex, 'tenant_secrets');
  await knex.schema.alterTable('tenant_secrets', (t) => {
    t.foreign(['tenant', 'created_by'], 'fk_tenant_secrets_created_by').references(['tenant', 'user_id']).inTable('users');
    t.foreign(['tenant', 'updated_by'], 'fk_tenant_secrets_updated_by').references(['tenant', 'user_id']).inTable('users');
  });

  await knex.schema.createTable('tenant_secrets_audit_log', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('secret_id').nullable();
    t.string('secret_name', 255).notNullable();
    t.text('event_type').notNullable();
    t.uuid('user_id').nullable();
    t.uuid('workflow_run_id').nullable();
    t.jsonb('context').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'id']);
    t.index(['tenant', 'secret_name'], 'idx_tenant_secrets_audit_name');
    t.index(['tenant', 'created_at'], 'idx_tenant_secrets_audit_created');
  });
  await knex.raw("ALTER TABLE tenant_secrets_audit_log ADD CONSTRAINT tenant_secrets_audit_event_type_check CHECK (event_type IN ('created', 'updated', 'deleted', 'accessed'))");
  await ensureTenantDistribution(knex, 'tenant_secrets_audit_log');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('tenant_secrets_audit_log');
  await knex.schema.dropTableIfExists('tenant_secrets');
};

exports.config = { transaction: false };
