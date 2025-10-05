/**
 * Development seed to create test ITIL board with priorities
 * This is for development/testing only - actual ITIL standards come from migrations
 */

exports.seed = async function(knex) {
  const tenant = await knex('tenants').first();
  if (!tenant) {
    console.log('No tenant found, skipping ITIL board creation');
    return;
  }

  // Check if ITIL test board already exists
  const itilBoard = await knex('boards')
    .where('tenant', tenant.tenant)
    .where('board_name', 'ITIL Support')
    .first();

  if (itilBoard) {
    console.log('ITIL Support board already exists, skipping...');
    return;
  }

  // Create ITIL-enabled board for testing
  const boardId = knex.raw('gen_random_uuid()');
  await knex('boards').insert({
    board_id: boardId,
    tenant: tenant.tenant,
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

  const createdByUser = await knex('users')
    .where('tenant', tenant.tenant)
    .orderBy('created_at')
    .first();

  if (!createdByUser) {
    console.log('No user found for tenant, skipping ITIL priorities seed');
    return;
  }

  const createdByUser = await knex('users')
    .where('tenant', tenant.tenant)
    .orderBy('created_at')
    .first();

  if (!createdByUser) {
    console.log('No user found for tenant, skipping ITIL priorities seed');
    return;
  }

  // Copy ITIL priorities from standard_priorities to tenant's priorities table
  // This simulates what should happen automatically when an ITIL board is created
  const itilStandardPriorities = await knex('standard_priorities')
    .where('is_itil_standard', true)
    .select('*');

  for (const stdPriority of itilStandardPriorities) {
    // Check if already exists in tenant priorities
    const existing = await knex('priorities')
      .where('tenant', tenant.tenant)
      .where('priority_name', stdPriority.priority_name)
      .where('item_type', stdPriority.item_type)
      .first();

    if (!existing) {
      await knex('priorities').insert({
        priority_id: knex.raw('gen_random_uuid()'),
        tenant: tenant.tenant,
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
};
