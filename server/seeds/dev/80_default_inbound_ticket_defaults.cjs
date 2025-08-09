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
    defaultChannelId,
    defaultStatusId,
    defaultPriorityId
  ] = await Promise.all([
    getDefaultId('channels', { is_default: true }, 'channel_id') || 
    getDefaultId('channels', {}, 'channel_id'), // Fallback to first channel
    
    getDefaultId('statuses', { is_default: true, status_type: 'ticket' }, 'status_id') ||
    getDefaultId('statuses', { status_type: 'ticket' }, 'status_id'), // Fallback to first ticket status
    
    // Priorities table doesn't have is_default column, so just get the first one
    getDefaultId('priorities', { item_type: 'ticket' }, 'priority_id')
  ]);

  if (!defaultChannelId || !defaultStatusId || !defaultPriorityId) {
    console.warn('Could not find required default values for ticket defaults. Skipping seed.');
    return;
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
    channel_id: defaultChannelId,
    status_id: defaultStatusId,
    priority_id: defaultPriorityId,
    company_id: null,
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