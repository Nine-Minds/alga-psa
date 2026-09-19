/**
 * Client Portal ticket visibility groups
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  const hasTenantsTable = await knex.schema.hasTable('tenants');
  const hasClientsTable = await knex.schema.hasTable('clients');
  const hasGroupsTable = await knex.schema.hasTable('client_portal_visibility_groups');
  const hasGroupBoardsTable = await knex.schema.hasTable('client_portal_visibility_group_boards');
  const hasContactsTable = await knex.schema.hasTable('contacts');
  const hasContactColumn = hasContactsTable
    ? await knex.schema.hasColumn('contacts', 'portal_visibility_group_id')
    : false;

  if (!hasGroupsTable) {
    await knex.schema.createTable('client_portal_visibility_groups', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('group_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('client_id').notNullable();
      table.string('name', 255).notNullable();
      table.text('description');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['tenant', 'group_id']);
      table.unique(['tenant', 'client_id', 'name']);
      if (hasTenantsTable) {
        table.foreign('tenant').references('tenants.tenant');
      }
      if (hasTenantsTable && hasClientsTable) {
        table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
      }
    });

    if (hasTenantsTable) {
      await knex.raw(`
        ALTER TABLE client_portal_visibility_groups
        ADD CONSTRAINT client_portal_visibility_groups_name_check
        CHECK (char_length(trim(name)) > 0)
      `);
    }

    await knex.raw(`
      CREATE INDEX idx_client_portal_visibility_groups_tenant_client
      ON client_portal_visibility_groups (tenant, client_id)
    `);
  }

  if (!hasGroupBoardsTable) {
    await knex.schema.createTable('client_portal_visibility_group_boards', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('group_id').notNullable();
      table.uuid('board_id').notNullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['tenant', 'group_id', 'board_id']);
      if (hasTenantsTable) {
        table.foreign('tenant').references('tenants.tenant');
      }
      if (hasTenantsTable) {
        table.foreign(['tenant', 'group_id']).references(['tenant', 'group_id']).inTable('client_portal_visibility_groups');
      }
      if (hasTenantsTable) {
        table.foreign(['tenant', 'board_id']).references(['tenant', 'board_id']).inTable('boards');
      }
    });

    await knex.raw(`
      CREATE INDEX idx_client_portal_visibility_group_boards_tenant_group
      ON client_portal_visibility_group_boards (tenant, group_id)
    `);
      await knex.raw(`
        CREATE INDEX idx_client_portal_visibility_group_boards_tenant_board
        ON client_portal_visibility_group_boards (tenant, board_id)
      `);
  }

  if (!hasContactColumn) {
    await knex.schema.alterTable('contacts', (table) => {
      table.uuid('portal_visibility_group_id');
    });

    await knex.raw(`
      ALTER TABLE contacts
      ADD CONSTRAINT client_portal_contacts_visibility_group_fkey
      FOREIGN KEY (tenant, portal_visibility_group_id)
      REFERENCES client_portal_visibility_groups (tenant, group_id)
      ON DELETE SET NULL
      ON UPDATE CASCADE
    `).catch(() => {});
  }
};

exports.down = async function(knex) {
  const hasContactsTable = await knex.schema.hasTable('contacts');
  const hasContactColumn = hasContactsTable
    ? await knex.schema.hasColumn('contacts', 'portal_visibility_group_id')
    : false;
  const hasGroupBoardsTable = await knex.schema.hasTable('client_portal_visibility_group_boards');
  const hasGroupsTable = await knex.schema.hasTable('client_portal_visibility_groups');

  if (hasContactColumn) {
    await knex.raw(`
      ALTER TABLE contacts
      DROP CONSTRAINT IF EXISTS client_portal_contacts_visibility_group_fkey
    `).catch(() => {});

    await knex.schema.alterTable('contacts', (table) => {
      table.dropColumn('portal_visibility_group_id');
    });
  }

  if (hasGroupBoardsTable) {
    await knex.schema.dropTable('client_portal_visibility_group_boards');
  }

  if (hasGroupsTable) {
    await knex.schema.dropTable('client_portal_visibility_groups');
  }
};
