/** Serialize lifecycle outbox delivery by condition, including databases that
 * already applied the initial lifecycle migration. */
exports.up = async function up(knex) {
  await knex.schema.alterTable('rmm_condition_states', (table) => {
    table.bigInteger('transition_sequence').notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('rmm_condition_transitions', (table) => {
    table.bigInteger('condition_sequence').nullable();
  });

  // Backfill through tenant-keyed updates so this remains valid when these
  // tables are distributed and colocated by tenant in Citus.
  const transitions = await knex('rmm_condition_transitions')
    .select('tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key', 'transition_id')
    .orderBy('tenant').orderBy('integration_id').orderBy('scope_key').orderBy('subject_key')
    .orderBy('condition_key').orderBy('created_at').orderBy('transition_id');
  const sequences = new Map();
  for (const row of transitions) {
    const key = [row.tenant, row.integration_id, row.scope_key, row.subject_key, row.condition_key].join('\0');
    const sequence = (sequences.get(key) || 0) + 1;
    sequences.set(key, sequence);
    await knex('rmm_condition_transitions')
      .where({ tenant: row.tenant, transition_id: row.transition_id })
      .update({ condition_sequence: sequence });
    await knex('rmm_condition_states')
      .where({ tenant: row.tenant, integration_id: row.integration_id, scope_key: row.scope_key,
        subject_key: row.subject_key, condition_key: row.condition_key })
      .update({ transition_sequence: sequence });
  }
  await knex.schema.alterTable('rmm_condition_transitions', (table) => {
    table.bigInteger('condition_sequence').notNullable().alter();
    table.index(
      ['tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key', 'status', 'condition_sequence'],
      'idx_rmm_condition_transition_order',
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('rmm_condition_transitions', (table) => {
    table.dropIndex(
      ['tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key', 'status', 'condition_sequence'],
      'idx_rmm_condition_transition_order',
    );
    table.dropColumn('condition_sequence');
  });
  await knex.schema.alterTable('rmm_condition_states', (table) => table.dropColumn('transition_sequence'));
};
