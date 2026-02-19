exports.seed = async function(knex) {
  // Get the tenant first
  const tenant = await knex('tenants').select('tenant').first();
  if (!tenant) {
    console.warn('No tenant found, skipping inbound ticket defaults seeding.');
    return;
  }
  const tenantId = tenant.tenant;

  // Helper function to get IDs for default configuration
  const getDefaultId = async (table, filters, idColumn) => {
    const result = await knex(table).where({ tenant: tenantId, ...filters }).select(idColumn).first();
    if (!result) {
      console.warn(`Warning: Could not find default ID in table '${table}' for filters:`, filters);
      return null;
    }
    return result[idColumn];
  };

  // Get default IDs for ticket creation
  const [
    defaultBoardId,
    defaultStatusId,
    defaultPriorityId,
    defaultClientId
  ] = await Promise.all([
    getDefaultId('boards', { is_default: true }, 'board_id') || 
    getDefaultId('boards', {}, 'board_id'), // Fallback to first board
    
    getDefaultId('statuses', { is_default: true, status_type: 'ticket' }, 'status_id') ||
    getDefaultId('statuses', { status_type: 'ticket' }, 'status_id'), // Fallback to first ticket status
    
    // Priorities table doesn't have is_default column, so just get the first one
    getDefaultId('priorities', { item_type: 'ticket' }, 'priority_id'),

    // Prefer a stable demo client if present, otherwise use any client.
    getDefaultId('clients', { client_name: 'Wonderland' }, 'client_id') ||
    getDefaultId('clients', {}, 'client_id')
  ]);

  if (!defaultBoardId || !defaultStatusId || !defaultPriorityId || !defaultClientId) {
    console.warn('Could not find required default values for ticket defaults. Skipping seed.');
    return;
  }

  // Backfill historical seeded rows where client_id was null.
  const updatedDefaults = await knex('inbound_ticket_defaults')
    .where({ tenant: tenantId })
    .whereNull('client_id')
    .update({
      client_id: defaultClientId,
      updated_at: knex.fn.now()
    });
  if (updatedDefaults > 0) {
    console.log(`✅ Backfilled client_id for ${updatedDefaults} inbound ticket defaults row(s).`);
  }

  // Check if default already exists
  const existingDefault = await knex('inbound_ticket_defaults')
    .where({ tenant: tenantId, short_name: 'email-general' })
    .first();

  if (existingDefault) {
    console.log('Default inbound ticket defaults already exist, skipping.');
    return;
  }

  // Create the default inbound ticket defaults configuration
  await knex('inbound_ticket_defaults').insert({
    id: knex.raw('gen_random_uuid()'),
    tenant: tenantId,
    short_name: 'email-general',
    display_name: 'General Email Support',
    description: 'Default configuration for tickets created from email processing',
    board_id: defaultBoardId,
    status_id: defaultStatusId,
    priority_id: defaultPriorityId,
    client_id: defaultClientId,
    entered_by: null, // System-generated tickets
    category_id: null,
    subcategory_id: null,
    location_id: null,
    is_default: true, // Mark as the default for this tenant
    is_active: true,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });

  console.log('✅ Created default inbound ticket defaults configuration');
};
