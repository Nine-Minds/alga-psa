exports.up = async function(knex) {
    await Promise.all([
      knex.schema.alterTable('users', (table) => {
        table.boolean('is_inactive').defaultTo(false);
      }),
      knex.schema.alterTable('companies', (table) => {
        table.boolean('is_inactive').defaultTo(false);
      }),
      knex.schema.alterTable('contacts', (table) => {
        table.boolean('is_inactive').defaultTo(false);
      }),
      knex.schema.alterTable('channels', (table) => {
        table.boolean('is_inactive').defaultTo(false);
      }),
      knex.schema.alterTable('projects', (table) => {
        table.boolean('is_inactive').defaultTo(false);
      })
    ]);
  };
  
  exports.down = async function(knex) {
    await Promise.all([
      knex.schema.alterTable('users', (table) => {
        table.dropColumn('is_inactive');
      }),
      knex.schema.alterTable('companies', (table) => {
        table.dropColumn('is_inactive');
      }),
      knex.schema.alterTable('contacts', (table) => {
        table.dropColumn('is_inactive');
      }),
      knex.schema.alterTable('channels', (table) => {
        table.dropColumn('is_inactive');
      }),
      knex.schema.alterTable('projects', (table) => {
        table.dropColumn('is_inactive');
      })
    ]);
  };