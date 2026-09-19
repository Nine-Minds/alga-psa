/**
 * Configurable agent subject claim per trusted IdP (F012). IdPs differ on which
 * claim identifies a machine agent (sub / azp / client_id). Default: 'sub'.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('agent_idp_providers', 'subject_claim'))) {
    await knex.schema.alterTable('agent_idp_providers', (t) => {
      t.string('subject_claim').notNullable().defaultTo('sub');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('agent_idp_providers', 'subject_claim')) {
    await knex.schema.alterTable('agent_idp_providers', (t) => {
      t.dropColumn('subject_claim');
    });
  }
};
