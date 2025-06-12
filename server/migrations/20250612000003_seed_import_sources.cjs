exports.up = async function(knex) {
  // Check if import_sources table exists
  const tableExists = await knex.schema.hasTable('import_sources');
  if (!tableExists) {
    console.log('import_sources table does not exist yet, skipping seed');
    return;
  }

  // Check if QBO source already exists
  const existingQbo = await knex('import_sources')
    .where({ source_id: 'qbo' })
    .first();

  if (!existingQbo) {
    // Insert QBO as an import source
    await knex('import_sources').insert([
      {
        source_id: 'qbo',
        display_name: 'QuickBooks Online',
        enabled: true,
        supports_import: true,
        supports_export: false,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
    console.log('✅ Added QuickBooks Online as import source');
  } else {
    console.log('QuickBooks Online import source already exists');
  }

  // Add other future import sources here
  // Example for CSV (disabled by default):
  const existingCsv = await knex('import_sources')
    .where({ source_id: 'csv' })
    .first();

  if (!existingCsv) {
    await knex('import_sources').insert([
      {
        source_id: 'csv',
        display_name: 'CSV File',
        enabled: false, // Disabled until implemented
        supports_import: true,
        supports_export: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
    console.log('✅ Added CSV as import source (disabled)');
  }
};

exports.down = async function(knex) {
  const tableExists = await knex.schema.hasTable('import_sources');
  if (tableExists) {
    // Remove the sources added by this migration
    await knex('import_sources')
      .whereIn('source_id', ['qbo', 'csv'])
      .del();
    console.log('Removed import sources');
  }
};