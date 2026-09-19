/**
 * Add lifecycle metadata to MSP SSO tenant login domains.
 *
 * This keeps existing domain rows functional while introducing explicit
 * claim state needed for EE verification/advisory routing policy.
 */

const CLAIM_STATUS_VALUES = [
  'advisory',
  'pending',
  'verified',
  'verified_legacy',
  'rejected',
  'revoked',
];

const CLAIM_STATUS_CHECK_NAME = 'msp_sso_tenant_login_domains_claim_status_check';

async function hasColumn(knex, tableName, columnName) {
  return knex.schema.hasColumn(tableName, columnName);
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) return;

  if (!(await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claim_status'))) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.text('claim_status').notNullable().defaultTo('advisory');
    });
  }

  if (!(await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claim_status_updated_at'))) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.timestamp('claim_status_updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claim_status_updated_by'))) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.uuid('claim_status_updated_by').nullable();
    });
  }

  if (!(await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claimed_at'))) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.timestamp('claimed_at', { useTz: true }).nullable();
    });
  }

  if (!(await hasColumn(knex, 'msp_sso_tenant_login_domains', 'verified_at'))) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.timestamp('verified_at', { useTz: true }).nullable();
    });
  }

  if (!(await hasColumn(knex, 'msp_sso_tenant_login_domains', 'rejected_at'))) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.timestamp('rejected_at', { useTz: true }).nullable();
    });
  }

  if (!(await hasColumn(knex, 'msp_sso_tenant_login_domains', 'revoked_at'))) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.timestamp('revoked_at', { useTz: true }).nullable();
    });
  }

  await knex.raw(`
    ALTER TABLE msp_sso_tenant_login_domains
    DROP CONSTRAINT IF EXISTS ${CLAIM_STATUS_CHECK_NAME};
  `);

  await knex.raw(`
    ALTER TABLE msp_sso_tenant_login_domains
    ADD CONSTRAINT ${CLAIM_STATUS_CHECK_NAME}
    CHECK (claim_status IN (${CLAIM_STATUS_VALUES.map((value) => `'${value}'`).join(', ')}));
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) return;

  await knex.raw(`
    ALTER TABLE msp_sso_tenant_login_domains
    DROP CONSTRAINT IF EXISTS ${CLAIM_STATUS_CHECK_NAME};
  `);

  if (await hasColumn(knex, 'msp_sso_tenant_login_domains', 'revoked_at')) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.dropColumn('revoked_at');
    });
  }

  if (await hasColumn(knex, 'msp_sso_tenant_login_domains', 'rejected_at')) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.dropColumn('rejected_at');
    });
  }

  if (await hasColumn(knex, 'msp_sso_tenant_login_domains', 'verified_at')) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.dropColumn('verified_at');
    });
  }

  if (await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claimed_at')) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.dropColumn('claimed_at');
    });
  }

  if (await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claim_status_updated_by')) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.dropColumn('claim_status_updated_by');
    });
  }

  if (await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claim_status_updated_at')) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.dropColumn('claim_status_updated_at');
    });
  }

  if (await hasColumn(knex, 'msp_sso_tenant_login_domains', 'claim_status')) {
    await knex.schema.alterTable('msp_sso_tenant_login_domains', (table) => {
      table.dropColumn('claim_status');
    });
  }
};
