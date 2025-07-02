exports.up = async function(knex) {
  console.log('Fixing tag case preservation...');
  
  // First, let's check if we have the original tags table still available
  const hasTagsTable = await knex.schema.hasTable('tags');
  
  if (!hasTagsTable) {
    console.log('Original tags table not found, cannot restore original case');
    return;
  }
  
  // Update tag_definitions to use the original case from the tags table
  console.log('Restoring original tag text case...');
  
  const updateResult = await knex.raw(`
    WITH original_tags AS (
      -- Get the first occurrence of each tag text with its original case
      SELECT DISTINCT ON (tenant, LOWER(tag_text), tagged_type)
        tenant,
        tag_text as original_text,
        LOWER(tag_text) as lower_text,
        tagged_type
      FROM tags
      ORDER BY tenant, LOWER(tag_text), tagged_type, created_at ASC
    )
    UPDATE tag_definitions td
    SET tag_text = ot.original_text
    FROM original_tags ot
    WHERE td.tenant = ot.tenant
      AND td.tag_text = ot.lower_text
      AND td.tagged_type = ot.tagged_type
    RETURNING td.*;
  `);
  
  console.log(`Updated ${updateResult.rows.length} tag definitions to preserve original case`);
};

exports.down = async function(knex) {
  console.log('Reverting tag case changes...');
  
  // Convert back to lowercase
  await knex.raw(`
    UPDATE tag_definitions
    SET tag_text = LOWER(tag_text)
  `);
  
  console.log('Reverted tags to lowercase');
};