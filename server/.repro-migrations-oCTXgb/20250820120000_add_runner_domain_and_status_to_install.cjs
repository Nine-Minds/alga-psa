/** EE-only migration: add runner_domain, runner_status, runner_ref to tenant_extension_install */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenant_extension_install');
  if (!hasTable) return;

  // Add columns if missing
  const hasRunnerDomain = await knex.schema.hasColumn('tenant_extension_install', 'runner_domain');
  if (!hasRunnerDomain) {
    await knex.schema.alterTable('tenant_extension_install', (t) => {
      t.text('runner_domain').unique().defaultTo(null);
    });
    // Index to accelerate lookup-by-host (unique already creates one; add a named index for clarity if needed)
    try {
      await knex.raw(
        `CREATE INDEX IF NOT EXISTS tenant_extension_install_runner_domain_idx ON tenant_extension_install (runner_domain)`
      );
    } catch (_e) {
      // ignore if unique created equivalent index
    }
  }

  const hasRunnerStatus = await knex.schema.hasColumn('tenant_extension_install', 'runner_status');
  if (!hasRunnerStatus) {
    await knex.schema.alterTable('tenant_extension_install', (t) => {
      t.jsonb('runner_status').notNullable().defaultTo(knex.raw(`'{"state":"pending"}'::jsonb`));
    });
  }

  const hasRunnerRef = await knex.schema.hasColumn('tenant_extension_install', 'runner_ref');
  if (!hasRunnerRef) {
    await knex.schema.alterTable('tenant_extension_install', (t) => {
      t.jsonb('runner_ref').defaultTo(null);
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenant_extension_install');
  if (!hasTable) return;

  const hasRunnerDomain = await knex.schema.hasColumn('tenant_extension_install', 'runner_domain');
  if (hasRunnerDomain) {
    await knex.schema.alterTable('tenant_extension_install', (t) => {
      t.dropColumn('runner_domain');
    });
    try {
      await knex.raw(
        `DROP INDEX IF EXISTS tenant_extension_install_runner_domain_idx`
      );
    } catch (_e) {
      // ignore
    }
  }

  const hasRunnerStatus = await knex.schema.hasColumn('tenant_extension_install', 'runner_status');
  if (hasRunnerStatus) {
    await knex.schema.alterTable('tenant_extension_install', (t) => {
      t.dropColumn('runner_status');
    });
  }

  const hasRunnerRef = await knex.schema.hasColumn('tenant_extension_install', 'runner_ref');
  if (hasRunnerRef) {
    await knex.schema.alterTable('tenant_extension_install', (t) => {
      t.dropColumn('runner_ref');
    });
  }
};

