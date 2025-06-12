exports.seed = async function(knex) {
  // Check if QBO source already exists
  const existingSource = await knex('import_sources')
    .where('source_id', 'qbo')
    .first();
    
  if (!existingSource) {
    // Insert QBO import source
    await knex('import_sources').insert({
      source_id: 'qbo',
      display_name: 'QuickBooks Online',
      enabled: true,
      supports_import: true,
      supports_export: false
    });
  }
};