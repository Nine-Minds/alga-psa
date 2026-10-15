/**
 * Development seed to create test ITIL board with statuses and priorities
 * This is for development/testing only - actual ITIL standards come from migrations
 */
const { randomUUID } = require('crypto');
const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
  const context = await getFirstTenantSeedContext(knex, {
    skipMessage: 'No tenant found, skipping ITIL board creation',
  });
  if (!context) {
    return;
  }

  const { db, tenantId } = context;

  // Check if ITIL test board already exists
  const itilBoard = await db.table('boards')
    .where('board_name', 'ITIL Support')
    .first();

  if (itilBoard) {
    console.log('ITIL Support board already exists, skipping...');
    return;
  }

  // Create ITIL-enabled board for testing
  const boardId = randomUUID();
  await db.table('boards').insert({
    board_id: boardId,
    tenant: tenantId,
    board_name: 'ITIL Support',
    description: 'ITIL-compliant support board for testing',
    category_type: 'itil',
    priority_type: 'itil',
    display_itil_impact: true,
    display_itil_urgency: true,
    display_priority: true,
    display_category: true,
    display_subcategory: true,
    display_order: 100,
    is_default: false,
    is_inactive: false
  });

  console.log('Created ITIL Support board for testing');

  const createdByUser = await db.table('users')
    .orderBy('created_at')
    .first();

  if (!createdByUser) {
    console.log('No user found for tenant, skipping ITIL priorities seed');
    return;
  }

  // Ticket statuses are per board. Copy the global catalog, as createBoard does,
  // so the board can open and close tickets with the product's standard set.
  const standardTicketStatuses = await knex('standard_statuses')
    .where({ item_type: 'ticket' })
    .orderBy('display_order', 'asc')
    .orderBy('name', 'asc');

  if (standardTicketStatuses.length === 0) {
    console.warn('No standard ticket statuses found; ITIL Support board has no statuses');
  } else {
    await db.table('statuses').insert(
      standardTicketStatuses.map((status) => ({
        tenant: tenantId,
        board_id: boardId,
        name: status.name,
        status_type: 'ticket',
        order_number: status.display_order,
        is_closed: Boolean(status.is_closed),
        is_default: Boolean(status.is_default),
        created_by: createdByUser.user_id
      }))
    );
    console.log(`Created ${standardTicketStatuses.length} ticket statuses for ITIL Support board`);
  }

  // Copy ITIL priorities from standard_priorities to tenant's priorities table
  // This simulates what should happen automatically when an ITIL board is created
  const itilStandardPriorities = await knex('standard_priorities')
    .where('is_itil_standard', true)
    .select('*');

  for (const stdPriority of itilStandardPriorities) {
    // Check if already exists in tenant priorities
    const existing = await db.table('priorities')
      .where('priority_name', stdPriority.priority_name)
      .where('item_type', stdPriority.item_type)
      .first();

    if (!existing) {
      await db.table('priorities').insert({
        priority_id: knex.raw('gen_random_uuid()'),
        tenant: tenantId,
        priority_name: stdPriority.priority_name,
        color: stdPriority.color,
        order_number: stdPriority.order_number,
        is_from_itil_standard: true,
        itil_priority_level: stdPriority.itil_priority_level,
        item_type: stdPriority.item_type,
        created_by: createdByUser.user_id,
        created_at: knex.fn.now()
      });
    }
  }

  console.log('Copied ITIL priorities to tenant for testing');

  // Mirror createBoard: default the board to the ITIL "Medium" (level 3) priority.
  const defaultPriority = await db.table('priorities')
    .where({ item_type: 'ticket', is_from_itil_standard: true })
    .orderByRaw('CASE WHEN itil_priority_level = 3 THEN 0 ELSE 1 END, order_number ASC, priority_name ASC')
    .first('priority_id');

  if (defaultPriority) {
    await db.table('boards')
      .where({ board_id: boardId })
      .update({ default_priority_id: defaultPriority.priority_id });
  }
};
