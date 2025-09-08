exports.up = async function(knex) {
  console.log('Fixing client document permissions from "documents" to "document"...');
  
  // Update client permissions from 'documents' to 'document' to match MSP permissions
  const result = await knex('permissions')
    .where({ resource: 'documents', client: true })
    .update({ resource: 'document' });
    
  console.log(`Updated ${result} client document permissions from "documents" to "document"`);
};

exports.down = async function(knex) {
  console.log('Reverting client document permissions from "document" to "documents"...');
  
  // Revert client permissions from 'document' back to 'documents'
  const result = await knex('permissions')
    .where({ resource: 'document', client: true })
    .update({ resource: 'documents' });
    
  console.log(`Reverted ${result} client document permissions from "document" to "documents"`);
};