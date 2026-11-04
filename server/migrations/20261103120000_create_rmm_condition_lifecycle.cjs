/** Durable, tenant-scoped state and outbox for observation-derived RMM conditions. */
exports.up = async function up(knex) {
  await knex.schema.createTable('rmm_condition_states', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('integration_id').notNullable();
    table.string('scope_key', 255).notNullable();
    table.string('subject_key', 255).notNullable();
    table.string('condition_key', 255).notNullable();
    table.string('state', 20).notNullable().defaultTo('healthy');
    table.timestamp('last_observation_at', { useTz: true }).nullable();
    table.string('last_observation_kind', 30).nullable();
    table.string('observation_fingerprint', 64).nullable();
    table.timestamp('last_trusted_evidence_at', { useTz: true }).nullable();
    table.timestamp('pending_since', { useTz: true }).nullable();
    table.uuid('current_outage_id').nullable();
    table.string('current_external_alert_id', 255).nullable();
    table.jsonb('event_payload').notNullable().defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key']);
    table
      .foreign(['tenant', 'integration_id'])
      .references(['tenant', 'integration_id'])
      .inTable('rmm_integrations')
      .onDelete('CASCADE');
    table.index(['tenant', 'integration_id', 'state'], 'idx_rmm_condition_states_active');
  });

  await knex.schema.createTable('rmm_condition_transitions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('transition_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('integration_id').notNullable();
    table.string('scope_key', 255).notNullable();
    table.string('subject_key', 255).notNullable();
    table.string('condition_key', 255).notNullable();
    table.uuid('outage_id').notNullable();
    table.string('transition_kind', 20).notNullable();
    table.string('external_alert_id', 255).notNullable();
    table.jsonb('event_payload').notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('delivered_at', { useTz: true }).nullable();
    table.primary(['tenant', 'transition_id']);
    table
      .foreign(['tenant', 'integration_id'])
      .references(['tenant', 'integration_id'])
      .inTable('rmm_integrations')
      .onDelete('CASCADE');
    table.index(['tenant', 'integration_id', 'status', 'created_at'], 'idx_rmm_condition_transitions_pending');
    table.index(['tenant', 'integration_id', 'external_alert_id'], 'idx_rmm_condition_transitions_alert');
  });

  const citus = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) {
    await knex.raw(
      "SELECT create_distributed_table('rmm_condition_states', 'tenant', colocate_with => 'rmm_integrations')",
    );
    await knex.raw(
      "SELECT create_distributed_table('rmm_condition_transitions', 'tenant', colocate_with => 'rmm_integrations')",
    );
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('rmm_condition_transitions');
  await knex.schema.dropTableIfExists('rmm_condition_states');
};
