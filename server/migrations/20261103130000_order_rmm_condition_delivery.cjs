/** Serialize lifecycle outbox delivery by condition, including databases that
 * already applied the initial lifecycle migration. */
exports.config = { transaction: false };

exports.up = async function up(knex) {
  // Keep expansion and backfill atomic; release their locks before building the
  // index concurrently. Defaults add NOT NULL columns without a table scan.
  await knex.transaction(async (trx) => {
    if (!(await trx.schema.hasColumn('rmm_condition_states', 'transition_sequence'))) {
      await trx.schema.alterTable('rmm_condition_states', (table) => {
        table.bigInteger('transition_sequence').notNullable().defaultTo(0);
      });
    }
    if (!(await trx.schema.hasColumn('rmm_condition_transitions', 'condition_sequence'))) {
      await trx.schema.alterTable('rmm_condition_transitions', (table) => {
        table.bigInteger('condition_sequence').notNullable().defaultTo(0);
      });
    }

    // Keyset pagination bounds memory, retains chronological order across batch
    // boundaries, and keeps every update tenant-keyed for Citus. Preserve the
    // exact timestamp text: JavaScript Date would lose PostgreSQL microseconds.
    const order = ['tenant', 'integration_id', 'scope_key', 'subject_key', 'condition_key', 'created_at', 'transition_id'];
    let cursor = null;
    let condition = null;
    let sequence = 0n;
    while (true) {
      const query = trx('rmm_condition_transitions')
        .select('*', trx.raw('created_at::text AS cursor_created_at'))
        .orderBy(order)
        .limit(500);
      if (cursor) {
        query.whereRaw('(??, ??, ??, ??, ??, ??, ??) > (?, ?, ?, ?, ?, ?, ?)', [...order, ...cursor]);
      }
      const transitions = await query;
      if (!transitions.length) break;
      for (const row of transitions) {
        const key = JSON.stringify([row.tenant, row.integration_id, row.scope_key, row.subject_key, row.condition_key]);
        if (key !== condition) {
          condition = key;
          sequence = 0n;
        }
        // A rerun must preserve sequences assigned by the running application,
        // including gaps left by deleted historical outbox rows.
        const existing = BigInt(row.condition_sequence);
        sequence = existing > 0n ? existing : sequence + 1n;
        if (existing === 0n) {
          await trx('rmm_condition_transitions')
            .where({ tenant: row.tenant, transition_id: row.transition_id })
            .update({ condition_sequence: sequence.toString() });
        }
        await trx('rmm_condition_states')
          .where({ tenant: row.tenant, integration_id: row.integration_id, scope_key: row.scope_key,
            subject_key: row.subject_key, condition_key: row.condition_key })
          .update({ transition_sequence: trx.raw('GREATEST(transition_sequence, ?::bigint)', [sequence.toString()]) });
        cursor = order.map(column => column === 'created_at' ? row.cursor_created_at : row[column]);
      }
    }
    // New application writers always assign a sequence explicitly.
    await trx.raw('ALTER TABLE rmm_condition_transitions ALTER COLUMN condition_sequence DROP DEFAULT');
  });

  // LEVERAGE: pattern concurrent-index-recovery — probe validity before retrying Citus concurrent DDL.
  const index = await knex.raw(`SELECT i.indisvalid FROM pg_index i
    WHERE i.indexrelid = to_regclass('idx_rmm_condition_transition_order')`);
  // Citus 12.1 invalidates an existing coordinator index when a concurrent
  // IF NOT EXISTS statement is repeated. Skip valid indexes before issuing DDL.
  if (!index.rows[0]?.indisvalid) {
    await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_rmm_condition_transition_order');
    await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rmm_condition_transition_order
      ON rmm_condition_transitions
      (tenant, integration_id, scope_key, subject_key, condition_key, status, condition_sequence)`);
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_rmm_condition_transition_order');
  await knex.raw('ALTER TABLE rmm_condition_transitions DROP COLUMN IF EXISTS condition_sequence');
  await knex.raw('ALTER TABLE rmm_condition_states DROP COLUMN IF EXISTS transition_sequence');
};
