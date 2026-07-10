exports.up = async function (knex) {
  const hasSuppressContact = await knex.schema.hasColumn('board_auto_close_rules', 'suppress_contact_notifications');
  if (!hasSuppressContact) {
    await knex.schema.alterTable('board_auto_close_rules', (table) => {
      table.boolean('suppress_contact_notifications').notNullable().defaultTo(false);
    });
  }

  const hasSuppressInternal = await knex.schema.hasColumn('board_auto_close_rules', 'suppress_internal_notifications');
  if (!hasSuppressInternal) {
    await knex.schema.alterTable('board_auto_close_rules', (table) => {
      table.boolean('suppress_internal_notifications').notNullable().defaultTo(false);
    });
  }

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'board_auto_close_rules_suppression_check'
      ) THEN
        ALTER TABLE board_auto_close_rules
          ADD CONSTRAINT board_auto_close_rules_suppression_check
          CHECK (suppress_contact_notifications OR NOT suppress_internal_notifications);
      END IF;
    END $$;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE board_auto_close_rules
      DROP CONSTRAINT IF EXISTS board_auto_close_rules_suppression_check;
  `);

  const hasSuppressInternal = await knex.schema.hasColumn('board_auto_close_rules', 'suppress_internal_notifications');
  if (hasSuppressInternal) {
    await knex.schema.alterTable('board_auto_close_rules', (table) => {
      table.dropColumn('suppress_internal_notifications');
    });
  }

  const hasSuppressContact = await knex.schema.hasColumn('board_auto_close_rules', 'suppress_contact_notifications');
  if (hasSuppressContact) {
    await knex.schema.alterTable('board_auto_close_rules', (table) => {
      table.dropColumn('suppress_contact_notifications');
    });
  }
};
