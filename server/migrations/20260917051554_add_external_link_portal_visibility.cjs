/** Private by default for existing rows and all future inserts on every tenant shard. */
exports.up = async function (knex) {
  await knex.schema.alterTable('external_entity_links', (table) => {
    table.boolean('portal_visible').notNullable().defaultTo(false);
  });
  await knex.raw(`ALTER TABLE external_entity_links
    ADD CONSTRAINT external_entity_links_portal_ticket_only
    CHECK (NOT portal_visible OR entity_type = 'ticket')`);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('external_entity_links', (table) => {
    table.dropColumn('portal_visible');
  });
};
