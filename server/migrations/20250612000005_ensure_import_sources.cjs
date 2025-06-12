exports.up = async function(knex) {
  console.log('Ensuring import sources are present...');
  
  // Define the import sources that should always exist
  const importSources = [
    {
      source_id: 'qbo',
      display_name: 'QuickBooks Online',
      enabled: true,
      supports_import: true,
      supports_export: false
    },
    {
      source_id: 'csv',
      display_name: 'CSV File',
      enabled: false, // Disabled until implemented
      supports_import: true,
      supports_export: true
    }
  ];
  
  // Insert or update each source
  for (const source of importSources) {
    const existing = await knex('import_sources')
      .where({ source_id: source.source_id })
      .first();
    
    if (!existing) {
      await knex('import_sources').insert({
        ...source,
        created_at: new Date(),
        updated_at: new Date()
      });
      console.log(`✅ Added ${source.display_name} as import source`);
    } else {
      // Update existing source to ensure correct settings
      await knex('import_sources')
        .where({ source_id: source.source_id })
        .update({
          display_name: source.display_name,
          enabled: source.enabled,
          supports_import: source.supports_import,
          supports_export: source.supports_export,
          updated_at: new Date()
        });
      console.log(`✅ Updated ${source.display_name} import source`);
    }
  }
  
  console.log('Import sources ensured');
};

exports.down = async function(knex) {
  // We don't remove import sources on down migration as they may have associated data
  console.log('Down migration does not remove import sources to preserve data integrity');
};