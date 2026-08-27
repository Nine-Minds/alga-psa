const DELIVERY_ERROR_CODES = [
  'graph_throttled',
  'graph_unauthorized',
  'graph_not_found',
  'graph_server_error',
  'user_not_mapped',
  'feature_disabled',
  'integration_inactive',
  'package_misconfigured',
  'transient',
  'unknown',
];

const LEGACY_DELIVERY_ERROR_CODES = [
  ...DELIVERY_ERROR_CODES,
  'addon_inactive',
];

async function replaceConstraint(knex, codes) {
  await knex.raw(`
    ALTER TABLE teams_notification_deliveries
      DROP CONSTRAINT IF EXISTS teams_notification_deliveries_error_code_check;
  `);
  await knex.raw(`
    ALTER TABLE teams_notification_deliveries
      ADD CONSTRAINT teams_notification_deliveries_error_code_check
      CHECK (error_code IS NULL OR error_code IN (${codes.map((code) => `'${code}'`).join(', ')}));
  `);
}

exports.up = async function up(knex) {
  await replaceConstraint(knex, LEGACY_DELIVERY_ERROR_CODES);
};

exports.down = async function down(knex) {
  await knex('teams_notification_deliveries')
    .where({ error_code: 'feature_disabled' })
    .update({ error_code: 'addon_inactive' });
  await replaceConstraint(knex, LEGACY_DELIVERY_ERROR_CODES.filter((code) => code !== 'feature_disabled'));
};
