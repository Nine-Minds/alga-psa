async function remapBoardScopedStatusReference(knex, tableName, boardColumn, statusColumn) {
  await knex.raw(
    `
      UPDATE ${tableName} AS target
      SET ${statusColumn} = cloned.status_id
      FROM statuses AS legacy
      INNER JOIN statuses AS cloned
        ON cloned.tenant = legacy.tenant
       AND cloned.status_type = 'ticket'
       AND cloned.name = legacy.name
      WHERE target.tenant = legacy.tenant
        AND target.${boardColumn} IS NOT NULL
        AND cloned.board_id = target.${boardColumn}
        AND target.${statusColumn} = legacy.status_id
        AND legacy.status_type = 'ticket'
        AND legacy.board_id IS NULL
    `
  );
}

async function restoreLegacyStatusReference(knex, tableName, statusColumn) {
  await knex.raw(
    `
      UPDATE ${tableName} AS target
      SET ${statusColumn} = legacy.status_id
      FROM statuses AS cloned
      INNER JOIN statuses AS legacy
        ON legacy.tenant = cloned.tenant
       AND legacy.status_type = 'ticket'
       AND legacy.board_id IS NULL
       AND legacy.name = cloned.name
      WHERE target.tenant = cloned.tenant
        AND target.${statusColumn} = cloned.status_id
        AND cloned.status_type = 'ticket'
        AND cloned.board_id IS NOT NULL
    `
  );
}

exports.up = async function up(knex) {
  await remapBoardScopedStatusReference(
    knex,
    'inbound_ticket_defaults',
    'board_id',
    'status_id'
  );

  await remapBoardScopedStatusReference(
    knex,
    'default_billing_settings',
    'renewal_ticket_board_id',
    'renewal_ticket_status_id'
  );

  await remapBoardScopedStatusReference(
    knex,
    'client_contracts',
    'renewal_ticket_board_id',
    'renewal_ticket_status_id'
  );
};

exports.down = async function down(knex) {
  await restoreLegacyStatusReference(knex, 'client_contracts', 'renewal_ticket_status_id');
  await restoreLegacyStatusReference(knex, 'default_billing_settings', 'renewal_ticket_status_id');
  await restoreLegacyStatusReference(knex, 'inbound_ticket_defaults', 'status_id');
};
