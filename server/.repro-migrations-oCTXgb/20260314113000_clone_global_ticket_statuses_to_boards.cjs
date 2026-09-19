const { randomUUID } = require('node:crypto');

function compareBoards(left, right) {
  return (
    (left.display_order ?? Number.MAX_SAFE_INTEGER) - (right.display_order ?? Number.MAX_SAFE_INTEGER) ||
    String(left.board_name ?? '').localeCompare(String(right.board_name ?? '')) ||
    String(left.board_id).localeCompare(String(right.board_id))
  );
}

function compareStatuses(left, right) {
  return (
    (left.order_number ?? Number.MAX_SAFE_INTEGER) - (right.order_number ?? Number.MAX_SAFE_INTEGER) ||
    String(left.name ?? '').localeCompare(String(right.name ?? '')) ||
    String(left.status_id).localeCompare(String(right.status_id))
  );
}

async function buildTicketStatusRemap(knex, tenant) {
  const legacyStatuses = await knex('statuses')
    .where({
      tenant,
      status_type: 'ticket',
    })
    .whereNull('board_id')
    .select('*');

  if (legacyStatuses.length === 0) {
    return [];
  }

  legacyStatuses.sort(compareStatuses);

  const boards = await knex('boards')
    .where({ tenant })
    .select('board_id', 'board_name', 'display_order');

  if (boards.length === 0) {
    return [];
  }

  boards.sort(compareBoards);

  const clonedStatuses = [];
  const remapRows = [];

  for (const board of boards) {
    for (const status of legacyStatuses) {
      const newStatusId = randomUUID();

      clonedStatuses.push({
        ...status,
        status_id: newStatusId,
        board_id: board.board_id,
      });

      remapRows.push({
        tenant,
        board_id: board.board_id,
        old_status_id: status.status_id,
        new_status_id: newStatusId,
      });
    }
  }

  await knex.batchInsert('statuses', clonedStatuses, 200);

  return remapRows;
}

async function remapTickets(knex, remapRows) {
  if (remapRows.length === 0) {
    return;
  }

  const valuesSql = remapRows.map(() => '(?, ?, ?, ?)').join(', ');
  const bindings = remapRows.flatMap((row) => [
    row.tenant,
    row.board_id,
    row.old_status_id,
    row.new_status_id,
  ]);

  await knex.raw(
    `
      UPDATE tickets AS t
      SET status_id = remap.new_status_id::uuid
      FROM (
        VALUES ${valuesSql}
      ) AS remap(tenant, board_id, old_status_id, new_status_id)
      WHERE t.tenant = remap.tenant::uuid
        AND t.board_id = remap.board_id::uuid
        AND t.status_id = remap.old_status_id::uuid
    `,
    bindings
  );
}

exports.up = async function up(knex) {
  const tenants = await knex('statuses')
    .distinct('tenant')
    .where({
      status_type: 'ticket',
    })
    .whereNull('board_id')
    .orderBy('tenant', 'asc');

  for (const { tenant } of tenants) {
    const remapRows = await buildTicketStatusRemap(knex, tenant);
    await remapTickets(knex, remapRows);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`
    UPDATE tickets AS t
    SET status_id = legacy.status_id
    FROM statuses AS cloned
    INNER JOIN statuses AS legacy
      ON legacy.tenant = cloned.tenant
     AND legacy.status_type = 'ticket'
     AND legacy.board_id IS NULL
     AND legacy.name = cloned.name
    WHERE cloned.status_type = 'ticket'
      AND cloned.board_id IS NOT NULL
      AND t.tenant = cloned.tenant
      AND t.status_id = cloned.status_id
  `);

  await knex('statuses')
    .where({
      status_type: 'ticket',
    })
    .whereNotNull('board_id')
    .del();
};
