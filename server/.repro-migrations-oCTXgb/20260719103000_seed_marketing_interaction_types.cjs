// System-wide interaction types for the marketing engagement log. Marketing
// follows the opportunities precedent (interactions reference
// system_interaction_types.type_id directly — see 'Note' in
// packages/opportunities/src/lib/completedActionInteraction.ts), so these are
// global rows available to every tenant, including tenants created after this
// migration runs. Code resolves them by type_name (see
// packages/marketing/src/lib/interactionTypes.ts).
const INTERACTION_TYPES = [
  { type_name: 'Marketing: Post Published', icon: 'share-2' },
  { type_name: 'Marketing: Email Sent', icon: 'mail' },
  { type_name: 'Marketing: Email Opened', icon: 'mail-open' },
  { type_name: 'Marketing: Email Clicked', icon: 'mouse-pointer-click' },
  { type_name: 'Marketing: Form Submitted', icon: 'clipboard-list' },
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasSystemTypes = await knex.schema.hasTable('system_interaction_types');
  if (!hasSystemTypes) {
    console.log('system_interaction_types table does not exist, skipping marketing interaction types');
    return;
  }

  for (const definition of INTERACTION_TYPES) {
    const existing = await knex('system_interaction_types')
      .where('type_name', definition.type_name)
      .first('type_id');

    if (!existing) {
      await knex('system_interaction_types').insert(definition);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasSystemTypes = await knex.schema.hasTable('system_interaction_types');
  if (!hasSystemTypes) {
    return;
  }

  await knex('system_interaction_types')
    .whereIn('type_name', INTERACTION_TYPES.map(({ type_name }) => type_name))
    .del();
};
