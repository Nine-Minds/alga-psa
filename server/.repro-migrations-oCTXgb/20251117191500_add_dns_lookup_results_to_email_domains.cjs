/**
 * Add dns_lookup_results + dns_last_checked_at columns to email_domains so we can persist DNS detections.
 */

exports.up = async function up(knex) {
  const hasEmailDomains = await knex.schema.hasTable('email_domains');
  if (!hasEmailDomains) {
    return;
  }

  await knex.schema.alterTable('email_domains', (table) => {
    if (typeof table.jsonb === 'function') {
      table.jsonb('dns_lookup_results');
    } else {
      table.json('dns_lookup_results');
    }
    table.timestamp('dns_last_checked_at');
  });
};

exports.down = async function down(knex) {
  const hasEmailDomains = await knex.schema.hasTable('email_domains');
  if (!hasEmailDomains) {
    return;
  }

  await knex.schema.alterTable('email_domains', (table) => {
    table.dropColumn('dns_lookup_results');
    table.dropColumn('dns_last_checked_at');
  });
};
