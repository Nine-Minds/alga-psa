exports.up = async function(knex) {
  // Keep this expression identical to ASSET_NAME_NORMALIZATION_SQL in inboundEmailRules/engine.ts.
  await knex.raw("CREATE INDEX IF NOT EXISTS idx_assets_tenant_normalized_name ON assets (tenant, lower(regexp_replace(trim(name), '\\s+', ' ', 'g')))");
  // Supports lower(contacts.email) = ? in the inbound rule contact matcher.
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_contacts_tenant_normalized_email_lookup ON contacts (tenant, lower(email))');
};

exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_contacts_tenant_normalized_email_lookup');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_tenant_normalized_name');
};
