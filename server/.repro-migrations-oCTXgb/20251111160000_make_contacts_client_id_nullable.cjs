/**
 * Migration: Make contacts.client_id nullable
 *
 * Contacts can exist without being associated with a specific client.
 * This migration removes the NOT NULL constraint if it exists.
 *
 * This is idempotent - it checks if the column is already nullable
 * before attempting to change it.
 */

exports.config = { transaction: true };

exports.up = async function(knex) {
  console.log('Checking contacts.client_id nullable constraint...');

  try {
    // Check if contacts table exists
    const tableExists = await knex.schema.hasTable('contacts');
    if (!tableExists) {
      console.log('⚠ contacts table does not exist, skipping...');
      return;
    }

    // Check if client_id column exists
    const hasColumn = await knex.schema.hasColumn('contacts', 'client_id');
    if (!hasColumn) {
      console.log('⚠ contacts.client_id column does not exist, skipping...');
      return;
    }

    // Check if column is already nullable
    const result = await knex.raw(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'contacts'
        AND column_name = 'client_id'
    `);

    if (result.rows.length === 0) {
      console.log('⚠ Could not determine nullable status for contacts.client_id, skipping...');
      return;
    }

    const isNullable = result.rows[0].is_nullable === 'YES';

    if (isNullable) {
      console.log('✓ contacts.client_id is already nullable, no change needed');
      return;
    }

    // Column is NOT NULL, so remove the constraint
    console.log('contacts.client_id is NOT NULL, removing constraint...');
    await knex.raw(`ALTER TABLE contacts ALTER COLUMN client_id DROP NOT NULL`);

    console.log('✓ contacts.client_id is now nullable');
  } catch (error) {
    console.error('❌ Failed to make contacts.client_id nullable:', error.message);
    throw error;
  }
};

exports.down = async function(knex) {
  console.log('Rolling back: Checking if we should make contacts.client_id NOT NULL...');

  try {
    // Check if contacts table exists
    const tableExists = await knex.schema.hasTable('contacts');
    if (!tableExists) {
      console.log('⚠ contacts table does not exist, skipping...');
      return;
    }

    // Check if client_id column exists
    const hasColumn = await knex.schema.hasColumn('contacts', 'client_id');
    if (!hasColumn) {
      console.log('⚠ contacts.client_id column does not exist, skipping...');
      return;
    }

    // Check if column is already NOT NULL
    const result = await knex.raw(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'contacts'
        AND column_name = 'client_id'
    `);

    if (result.rows.length === 0) {
      console.log('⚠ Could not determine nullable status for contacts.client_id, skipping...');
      return;
    }

    const isNullable = result.rows[0].is_nullable === 'YES';

    if (!isNullable) {
      console.log('✓ contacts.client_id is already NOT NULL, no change needed');
      return;
    }

    // Check for NULL values before adding constraint
    const nullCount = await knex('contacts').whereNull('client_id').count('* as count');
    if (parseInt(nullCount[0].count) > 0) {
      console.log(`⚠ contacts table has ${nullCount[0].count} NULL client_id values`);
      console.log('Cannot add NOT NULL constraint. Please update these records first.');
      throw new Error('Cannot add NOT NULL constraint: NULL values exist');
    }

    // Add back NOT NULL constraint
    console.log('Making contacts.client_id NOT NULL...');
    await knex.raw(`ALTER TABLE contacts ALTER COLUMN client_id SET NOT NULL`);

    console.log('✓ contacts.client_id is now NOT NULL');
  } catch (error) {
    console.error('❌ Failed to make contacts.client_id NOT NULL:', error.message);
    throw error;
  }
};
