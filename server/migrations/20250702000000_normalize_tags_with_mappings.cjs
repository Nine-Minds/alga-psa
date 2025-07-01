exports.up = async function(knex) {
  console.log('Starting tag normalization migration...');
  
  // Step 1: Create tag_definitions table
  console.log('Creating tag_definitions table...');
  await knex.schema.createTable('tag_definitions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('tag_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('tag_text').notNullable();
    table.text('tagged_type').notNullable();
    table.uuid('channel_id');
    table.string('background_color');
    table.string('text_color');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Primary key and constraints
    table.primary(['tenant', 'tag_id']);
    table.unique(['tenant', 'tag_text', 'tagged_type']);
    
    // Foreign keys
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('channels');
    
    // Indexes
    table.index(['tenant', 'tagged_type']);
    table.index(['tenant', 'tag_text']);
  });
  
  // Step 2: Create tag_mappings table
  console.log('Creating tag_mappings table...');
  await knex.schema.createTable('tag_mappings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('mapping_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('tag_id').notNullable();
    table.uuid('tagged_id').notNullable();
    table.text('tagged_type').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.uuid('created_by');
    
    // Primary key and constraints
    table.primary(['tenant', 'mapping_id']);
    table.unique(['tenant', 'tag_id', 'tagged_id']);
    
    // Foreign keys
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'tag_id']).references(['tenant', 'tag_id']).inTable('tag_definitions').onDelete('CASCADE');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
    
    // Indexes for performance
    table.index(['tenant', 'tagged_id', 'tagged_type']);
    table.index(['tenant', 'tag_id']);
    table.index(['tenant', 'tagged_type']);
  });
  
  // Step 3: Migrate existing tag data to tag_definitions
  console.log('Migrating unique tags to tag_definitions...');
  
  // Get count of existing tags for progress tracking
  const [{ count: totalTags }] = await knex('tags').count('* as count');
  console.log(`Found ${totalTags} total tags to process...`);
  
  // Insert unique tag definitions
  // For tags with same text but different colors, we'll pick the most commonly used color combination
  const insertedDefinitions = await knex.raw(`
    WITH tag_color_counts AS (
      SELECT 
        tenant,
        LOWER(tag_text) as tag_text,
        tagged_type,
        channel_id,
        background_color,
        text_color,
        COUNT(*) as usage_count
      FROM tags
      GROUP BY tenant, LOWER(tag_text), tagged_type, channel_id, background_color, text_color
    ),
    ranked_tags AS (
      SELECT 
        *,
        ROW_NUMBER() OVER (
          PARTITION BY tenant, tag_text, tagged_type 
          ORDER BY usage_count DESC
        ) as rn
      FROM tag_color_counts
    )
    INSERT INTO tag_definitions (tenant, tag_id, tag_text, tagged_type, channel_id, background_color, text_color, created_at)
    SELECT 
      tenant,
      gen_random_uuid() as tag_id,
      tag_text,
      tagged_type,
      channel_id,
      background_color,
      text_color,
      NOW() as created_at
    FROM ranked_tags
    WHERE rn = 1
    RETURNING *
  `);
  
  console.log(`Created ${insertedDefinitions.rows.length} tag definitions`);
  
  // Step 4: Create mappings from existing tags
  console.log('Creating tag mappings from existing tags...');
  
  // Create temporary index to speed up the join
  await knex.raw('CREATE INDEX temp_tags_lookup ON tags(tenant, LOWER(tag_text), tagged_type)');
  
  const insertedMappings = await knex.raw(`
    INSERT INTO tag_mappings (tenant, mapping_id, tag_id, tagged_id, tagged_type, created_at)
    SELECT 
      t.tenant,
      t.tag_id as mapping_id, -- Reuse existing tag_id as mapping_id
      td.tag_id,
      t.tagged_id,
      t.tagged_type,
      NOW() as created_at
    FROM tags t
    JOIN tag_definitions td ON 
      t.tenant = td.tenant AND 
      LOWER(t.tag_text) = td.tag_text AND 
      t.tagged_type = td.tagged_type
    ON CONFLICT (tenant, tag_id, tagged_id) DO NOTHING
    RETURNING *
  `);
  
  console.log(`Created ${insertedMappings.rows.length} tag mappings`);
  
  // Drop temporary index
  await knex.raw('DROP INDEX temp_tags_lookup');
  
  // Step 5: Verify migration integrity
  console.log('Verifying migration integrity...');
  
  // Check if all tags were migrated
  const [{ original_count }] = await knex('tags').count('* as original_count');
  const [{ mapping_count }] = await knex('tag_mappings').count('* as mapping_count');
  
  if (original_count !== mapping_count) {
    console.warn(`Warning: Tag count mismatch. Original: ${original_count}, Mappings: ${mapping_count}`);
    
    // Log unmigrated tags for investigation
    const unmigrated = await knex.raw(`
      SELECT t.*
      FROM tags t
      LEFT JOIN tag_mappings tm ON t.tenant = tm.tenant AND t.tag_id = tm.mapping_id
      WHERE tm.mapping_id IS NULL
      LIMIT 10
    `);
    
    if (unmigrated.rows.length > 0) {
      console.log('Sample unmigrated tags:', unmigrated.rows);
    }
  } else {
    console.log('✓ All tags successfully migrated');
  }
  
  // Step 6: Add comment to indicate migration status
  await knex.raw(`
    COMMENT ON TABLE tags IS 'DEPRECATED: Migrated to tag_definitions and tag_mappings. To be removed after verification.';
  `);
  
  console.log('Tag normalization migration completed successfully');
  console.log('Note: Original tags table preserved for rollback capability');
};

exports.down = async function(knex) {
  console.log('Rolling back tag normalization...');
  
  // Drop the new tables in reverse order
  await knex.schema.dropTableIfExists('tag_mappings');
  await knex.schema.dropTableIfExists('tag_definitions');
  
  // Remove deprecation comment
  await knex.raw(`
    COMMENT ON TABLE tags IS NULL;
  `);
  
  console.log('Tag normalization rollback completed');
};