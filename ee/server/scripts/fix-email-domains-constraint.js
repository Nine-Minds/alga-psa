/**
 * Quick script to fix the email_domains status constraint
 */

const knex = require('knex');

async function createDbConnection() {
  return knex({
    client: 'pg',
    connection: {
      host: process.env.DATABASE_HOST || 'localhost',
      port: process.env.DATABASE_PORT || 5432,
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_NAME || 'alga_psa_dev',
    },
  });
}

async function fixConstraint() {
  const db = await createDbConnection();

  try {
    console.log('Dropping old constraint...');
    await db.raw(`
      ALTER TABLE email_domains
      DROP CONSTRAINT IF EXISTS email_domains_status_check
    `);

    console.log('Adding new constraint with "deleting" status...');
    await db.raw(`
      ALTER TABLE email_domains
      ADD CONSTRAINT email_domains_status_check
      CHECK (status IN ('pending', 'verified', 'failed', 'deleting'))
    `);

    console.log('✓ Successfully updated email_domains status constraint');
  } catch (error) {
    console.error('Error updating constraint:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

fixConstraint();
