const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function(knex) {
  const context = await getFirstTenantSeedContext(knex, {
    skipMessage: 'No tenant found, skipping inbound ticket defaults seeding.',
  });
  if (!context) return;

  const { db, tenantId } = context;

  // Helper function to get IDs for default configuration
  const getDefaultId = async (table, filters, idColumn) => {
    const result = await db.table(table).where(filters).select(idColumn).first();
    if (!result) {
      console.warn(`Warning: Could not find default ID in table '${table}' for filters:`, filters);
      return null;
    }
    return result[idColumn];
  };

  const defaultBoardId =
    await getDefaultId('boards', { is_default: true }, 'board_id') ||
    await getDefaultId('boards', {}, 'board_id');

  const defaultStatusId = defaultBoardId
    ? (
        await getDefaultId('statuses', { board_id: defaultBoardId, is_default: true, status_type: 'ticket' }, 'status_id') ||
        await getDefaultId('statuses', { board_id: defaultBoardId, status_type: 'ticket' }, 'status_id')
      )
    : null;

  const [
    defaultPriorityId,
    defaultClientId
  ] = await Promise.all([
    getDefaultId('priorities', { item_type: 'ticket' }, 'priority_id'),
    getDefaultId('clients', { client_name: 'Wonderland' }, 'client_id') ||
    getDefaultId('clients', {}, 'client_id')
  ]);

  if (!defaultBoardId || !defaultStatusId || !defaultPriorityId || !defaultClientId) {
    console.warn('Could not find required default values for ticket defaults. Skipping seed.');
    return;
  }

  // Backfill historical seeded rows where client_id was null.
  const updatedDefaults = await db.table('inbound_ticket_defaults')
    .whereNull('client_id')
    .update({
      client_id: defaultClientId,
      updated_at: knex.fn.now()
    });
  if (updatedDefaults > 0) {
    console.log(`✅ Backfilled client_id for ${updatedDefaults} inbound ticket defaults row(s).`);
  }

  // Check if default already exists
  const existingDefault = await db.table('inbound_ticket_defaults')
    .where({ short_name: 'email-general' })
    .first();

  if (existingDefault) {
    console.log('Default inbound ticket defaults already exist, skipping.');
    return;
  }

  // Create the default inbound ticket defaults configuration
  await db.table('inbound_ticket_defaults').insert({
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
