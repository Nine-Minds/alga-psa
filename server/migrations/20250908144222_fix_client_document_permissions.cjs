exports.up = async function(knex) {
  console.log('Fixing client document permissions from "documents" to "document"...');
  
  // Get all tenants to handle Citus distributed table properly
  const tenants = await knex('tenants').select('tenant');
  
  let totalUpdated = 0;
  let totalSkipped = 0;
  
  for (const { tenant } of tenants) {
    // Check if 'document' permissions already exist for this tenant
    const existingDocument = await knex('permissions')
      .where({ 
        tenant, 
        resource: 'document', 
        client: true 
      })
      .first();
    
    if (existingDocument) {
      totalSkipped++;
      console.log(`Skipping tenant ${tenant} - 'document' permissions already exist`);
      continue;
    }
    
    // Update 'documents' to 'document'
    const updated = await knex('permissions')
      .where({ 
        tenant, 
        resource: 'documents', 
        client: true 
      })
      .update({ resource: 'document' });
    
    if (updated > 0) {
      totalUpdated += updated;
      console.log(`Updated ${updated} permissions for tenant ${tenant}`);
    }
  }
  
  console.log(`Migration complete: Updated ${totalUpdated} permissions, skipped ${totalSkipped} tenants`);
};

exports.down = async function(knex) {
  console.log('Reverting client document permissions from "document" to "documents"...');
  
  // Get all tenants to handle Citus distributed table properly
  const tenants = await knex('tenants').select('tenant');
  
  let totalUpdated = 0;
  
  for (const { tenant } of tenants) {
    // Simply revert 'document' back to 'documents'
    const updated = await knex('permissions')
      .where({ 
        tenant, 
        resource: 'document', 
        client: true 
      })
      .update({ resource: 'documents' });
    
    if (updated > 0) {
      totalUpdated += updated;
      console.log(`Reverted ${updated} permissions for tenant ${tenant}`);
    }
  }
  
  console.log(`Reverted ${totalUpdated} client document permissions from "document" to "documents"`);
};