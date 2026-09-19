/**
 * Remove is_initial_description column and add markdown_content column to comments table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if is_initial_description column exists
    const hasColumn = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comments' AND column_name = 'is_initial_description'
      );
    `);
    
    if (hasColumn.rows[0].exists) {
      // Drop the view that depends on the column first
      await trx.raw('DROP VIEW IF EXISTS v_ticket_comments');
      
      // For Citus compatibility, we need to use ALTER TABLE directly
      // This is safe because dropping a column is a metadata operation in PostgreSQL
      await trx.raw('ALTER TABLE comments DROP COLUMN is_initial_description');
    }
    
    // Add the new markdown column
    await trx.raw('ALTER TABLE comments ADD COLUMN markdown_content TEXT');
  });
};

/**
 * Restore is_initial_description column and remove markdown_content column from comments table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // Check if is_initial_description column exists
    const hasColumn = await trx.raw(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comments' AND column_name = 'is_initial_description'
      );
    `);
    
    if (!hasColumn.rows[0].exists) {
      // Add back the is_initial_description column
      await trx.raw('ALTER TABLE comments ADD COLUMN is_initial_description BOOLEAN NOT NULL DEFAULT FALSE');
    }
    
    // Remove the markdown column
    await trx.raw('ALTER TABLE comments DROP COLUMN IF EXISTS markdown_content');
  });
};