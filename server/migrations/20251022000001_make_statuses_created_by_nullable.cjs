/**
 * Make created_by column nullable in statuses table
 * This allows seed scripts to create default statuses before users exist
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Making statuses.created_by nullable...');

  try {
    // Step 1: Drop the foreign key constraint
    console.log('  Dropping foreign key constraint statuses_tenant_created_by_foreign...');
    await knex.raw(`
      ALTER TABLE statuses
      DROP CONSTRAINT IF EXISTS statuses_tenant_created_by_foreign
    `);
    console.log('    ✓ Foreign key constraint dropped');

    // Step 2: Make the column nullable
    console.log('  Altering created_by column to allow NULL...');
    await knex.raw(`
      ALTER TABLE statuses
      ALTER COLUMN created_by DROP NOT NULL
    `);
    console.log('    ✓ Column altered to allow NULL');

    // Step 3: Recreate the foreign key constraint (now allowing NULL)
    console.log('  Recreating foreign key constraint...');
    await knex.raw(`
      ALTER TABLE statuses
      ADD CONSTRAINT statuses_tenant_created_by_foreign
      FOREIGN KEY (tenant, created_by)
      REFERENCES users(tenant, user_id)
    `);
    console.log('    ✓ Foreign key constraint recreated');

    console.log('✓ Successfully made statuses.created_by nullable');
  } catch (error) {
    console.error(`✗ Failed to make created_by nullable: ${error.message}`);
    throw error;
  }
};

exports.down = async function(knex) {
  console.log('Reverting statuses.created_by to NOT NULL...');

  try {
    // Note: This will fail if there are any NULL values in the column
    // You would need to update those first

    // Step 1: Drop the foreign key constraint
    console.log('  Dropping foreign key constraint...');
    await knex.raw(`
      ALTER TABLE statuses
      DROP CONSTRAINT IF EXISTS statuses_tenant_created_by_foreign
    `);

    // Step 2: Make the column NOT NULL
    // First, update any NULL values (if needed)
    console.log('  Checking for NULL values...');
    const nullCount = await knex.raw(`
      SELECT COUNT(*) as count
      FROM statuses
      WHERE created_by IS NULL
    `);

    if (parseInt(nullCount.rows[0].count) > 0) {
      console.log(`  Warning: Found ${nullCount.rows[0].count} rows with NULL created_by`);
      console.log(`  These must be updated before the column can be made NOT NULL`);
      throw new Error('Cannot revert: NULL values exist in created_by column');
    }

    console.log('  Making created_by NOT NULL...');
    await knex.raw(`
      ALTER TABLE statuses
      ALTER COLUMN created_by SET NOT NULL
    `);

    // Step 3: Recreate the foreign key constraint
    console.log('  Recreating foreign key constraint...');
    await knex.raw(`
      ALTER TABLE statuses
      ADD CONSTRAINT statuses_tenant_created_by_foreign
      FOREIGN KEY (tenant, created_by)
      REFERENCES users(tenant, user_id)
    `);

    console.log('✓ Successfully reverted created_by to NOT NULL');
  } catch (error) {
    console.error(`✗ Failed to revert: ${error.message}`);
    throw error;
  }
};
