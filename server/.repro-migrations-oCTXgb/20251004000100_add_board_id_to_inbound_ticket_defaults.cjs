/**
 * Ensure inbound ticket defaults reference boards via board_id.
 */

exports.up = async function up(knex) {
  const hasBoardColumn = await knex.schema.hasColumn('inbound_ticket_defaults', 'board_id');
  if (!hasBoardColumn) {
    await knex.schema.table('inbound_ticket_defaults', (table) => {
      table.uuid('board_id').nullable();
    });
  }

  const tenants = await knex('inbound_ticket_defaults').distinct('tenant').pluck('tenant');
  for (const tenant of tenants) {
    const existing = await knex('inbound_ticket_defaults')
      .where({ tenant })
      .whereNotNull('board_id')
      .first();
    if (existing) continue;

    const preferredBoard = await knex('boards')
      .where({ tenant, is_default: true })
      .select('board_id')
      .first();

    const fallbackBoard = preferredBoard || (await knex('boards')
      .where({ tenant })
      .select('board_id')
      .first());

    if (!fallbackBoard) {
      console.warn(`⚠️  No board found for tenant ${tenant}. Leaving inbound_ticket_defaults.board_id null.`);
      continue;
    }

    await knex('inbound_ticket_defaults')
      .where({ tenant })
      .update({ board_id: fallbackBoard.board_id });
  }

  // Helpful index for lookups
  const hasIndex = await knex.raw(`
    SELECT to_regclass('public.inbound_ticket_defaults_tenant_board_idx') IS NOT NULL AS exists;
  `);
  if (!hasIndex.rows[0].exists) {
    await knex.schema.table('inbound_ticket_defaults', (table) => {
      table.index(['tenant', 'board_id'], 'inbound_ticket_defaults_tenant_board_idx');
    });
  }
};

exports.down = async function down(knex) {
  const hasIndex = await knex.raw(`
    SELECT to_regclass('public.inbound_ticket_defaults_tenant_board_idx') IS NOT NULL AS exists;
  `);
  if (hasIndex.rows[0].exists) {
    await knex.schema.table('inbound_ticket_defaults', (table) => {
      table.dropIndex(['tenant', 'board_id'], 'inbound_ticket_defaults_tenant_board_idx');
    });
  }

  const hasBoardColumn = await knex.schema.hasColumn('inbound_ticket_defaults', 'board_id');
  if (hasBoardColumn) {
    await knex.schema.table('inbound_ticket_defaults', (table) => {
      table.dropColumn('board_id');
    });
  }
};
