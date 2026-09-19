/**
 * Allow Microsoft Graph to be selected as the tenant's outbound provider.
 *
 * The original table used Knex's PostgreSQL enum helper, which created a text
 * column plus a CHECK constraint limited to smtp, resend, and hybrid. The
 * application now persists "microsoft" when a connected Graph mailbox is
 * selected, so deployed databases need the constraint widened explicitly.
 *
 * Adding the replacement NOT VALID avoids an initial table scan while holding
 * ACCESS EXCLUSIVE. Validation follows immediately with a less restrictive
 * lock. The new constraint is strictly wider, so existing rows already satisfy
 * it.
 */

const { tenantDb } = require('./utils/tenantDb.cjs');

const TABLE_NAME = 'tenant_email_settings';
const CONSTRAINT_NAME = 'tenant_email_settings_email_provider_check';
const MIGRATION_TENANT = 'migration:20260803044749_allow_microsoft_tenant_email_provider';
const ROLLBACK_SAFETY_REASON = 'check all tenant email settings before narrowing provider constraint';
const ORIGINAL_PROVIDERS = ['smtp', 'resend', 'hybrid'];
const MICROSOFT_PROVIDERS = [...ORIGINAL_PROVIDERS, 'microsoft'];

function sqlList(values) {
  return values.map((value) => `'${value}'`).join(', ');
}

async function setProviderConstraint(knex, providers) {
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [TABLE_NAME, CONSTRAINT_NAME]);
  await knex.raw(
    `ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (email_provider IN (${sqlList(providers)})) NOT VALID`,
    [TABLE_NAME, CONSTRAINT_NAME]
  );
  await knex.raw('ALTER TABLE ?? VALIDATE CONSTRAINT ??', [TABLE_NAME, CONSTRAINT_NAME]);
}

exports.up = async function up(knex) {
  await setProviderConstraint(knex, MICROSOFT_PROVIDERS);
};

exports.down = async function down(knex) {
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const microsoftSetting = await migrationDb
    .unscoped(TABLE_NAME, ROLLBACK_SAFETY_REASON)
    .where({ email_provider: 'microsoft' })
    .first('id');

  if (microsoftSetting) {
    throw new Error(
      'Cannot roll back Microsoft outbound email support while tenant email settings still use the microsoft provider'
    );
  }

  await setProviderConstraint(knex, ORIGINAL_PROVIDERS);
};
