/**
 * Tracks administrator consent for profiles created by the guided Microsoft
 * Email setup. Existing/manual profiles retain their historical readiness
 * behavior because consent is not marked as required for those rows.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_profiles');
  if (!hasTable) return;

  const hasRequired = await knex.schema.hasColumn(
    'microsoft_profiles',
    'email_admin_consent_required'
  );
  const hasGrantedAt = await knex.schema.hasColumn(
    'microsoft_profiles',
    'email_admin_consent_granted_at'
  );
  const hasTenantId = await knex.schema.hasColumn(
    'microsoft_profiles',
    'email_admin_consent_tenant_id'
  );

  await knex.schema.alterTable('microsoft_profiles', (table) => {
    if (!hasRequired) {
      table.boolean('email_admin_consent_required').notNullable().defaultTo(false);
    }
    if (!hasGrantedAt) {
      table.timestamp('email_admin_consent_granted_at', { useTz: true });
    }
    if (!hasTenantId) {
      table.text('email_admin_consent_tenant_id');
    }
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_profiles');
  if (!hasTable) return;

  await knex.schema.alterTable('microsoft_profiles', (table) => {
    table.dropColumn('email_admin_consent_tenant_id');
    table.dropColumn('email_admin_consent_granted_at');
    table.dropColumn('email_admin_consent_required');
  });
};

exports.config = { transaction: false };
