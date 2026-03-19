/**
 * Persist Teams app/package metadata directly on the tenant Teams integration record.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('teams_integrations');
  if (!hasTable) {
    return;
  }

  const hasAppId = await knex.schema.hasColumn('teams_integrations', 'app_id');
  if (!hasAppId) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.text('app_id');
    });
  }

  const hasBotId = await knex.schema.hasColumn('teams_integrations', 'bot_id');
  if (!hasBotId) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.text('bot_id');
    });
  }

  const hasPackageMetadata = await knex.schema.hasColumn('teams_integrations', 'package_metadata');
  if (!hasPackageMetadata) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.jsonb('package_metadata');
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('teams_integrations');
  if (!hasTable) {
    return;
  }

  const hasPackageMetadata = await knex.schema.hasColumn('teams_integrations', 'package_metadata');
  if (hasPackageMetadata) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.dropColumn('package_metadata');
    });
  }

  const hasBotId = await knex.schema.hasColumn('teams_integrations', 'bot_id');
  if (hasBotId) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.dropColumn('bot_id');
    });
  }

  const hasAppId = await knex.schema.hasColumn('teams_integrations', 'app_id');
  if (hasAppId) {
    await knex.schema.alterTable('teams_integrations', (table) => {
      table.dropColumn('app_id');
    });
  }
};

exports.config = { transaction: false };
