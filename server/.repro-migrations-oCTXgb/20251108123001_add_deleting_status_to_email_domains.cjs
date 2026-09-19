/**
 * Add 'deleting' status to email_domains table
 *
 * The deleteManagedEmailDomain action needs to set status to 'deleting'
 * before triggering the workflow, but the original enum only allowed
 * 'pending', 'verified', 'failed'.
 */

exports.up = async function(knex) {
  // Drop the existing check constraint
  await knex.raw(`
    ALTER TABLE email_domains
    DROP CONSTRAINT IF EXISTS email_domains_status_check
  `);

  // Add the new check constraint with 'deleting' included
  await knex.raw(`
    ALTER TABLE email_domains
    ADD CONSTRAINT email_domains_status_check
    CHECK (status IN ('pending', 'verified', 'failed', 'deleting'))
  `);

  console.log('Added "deleting" status to email_domains check constraint');
};

exports.down = async function(knex) {
  // Restore the original constraint without 'deleting'
  await knex.raw(`
    ALTER TABLE email_domains
    DROP CONSTRAINT IF EXISTS email_domains_status_check
  `);

  await knex.raw(`
    ALTER TABLE email_domains
    ADD CONSTRAINT email_domains_status_check
    CHECK (status IN ('pending', 'verified', 'failed'))
  `);

  console.log('Removed "deleting" status from email_domains check constraint');
};
