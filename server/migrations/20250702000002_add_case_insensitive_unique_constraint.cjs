exports.up = async function(knex) {
  console.log('Adding case-insensitive unique constraint to tag_definitions...');
  
  // First drop the existing constraint
  await knex.raw(`
    ALTER TABLE tag_definitions 
    DROP CONSTRAINT IF EXISTS tag_definitions_tenant_tag_text_tagged_type_unique;
  `);
  
  // Add a case-insensitive unique index
  await knex.raw(`
    CREATE UNIQUE INDEX tag_definitions_tenant_tag_text_tagged_type_unique 
    ON tag_definitions (tenant, LOWER(tag_text), tagged_type);
  `);
  
  console.log('Case-insensitive unique constraint added successfully');
};

exports.down = async function(knex) {
  console.log('Reverting to case-sensitive unique constraint...');
  
  // Drop the case-insensitive index
  await knex.raw(`
    DROP INDEX IF EXISTS tag_definitions_tenant_tag_text_tagged_type_unique;
  `);
  
  // Re-add the original case-sensitive constraint
  await knex.raw(`
    ALTER TABLE tag_definitions 
    ADD CONSTRAINT tag_definitions_tenant_tag_text_tagged_type_unique 
    UNIQUE (tenant, tag_text, tagged_type);
  `);
  
  console.log('Reverted to case-sensitive constraint');
};