/**
 * Refresh the `payment-received` email template so the "View Invoice" link is
 * omitted when no absolute portal URL is available (invoice.url absent),
 * instead of rendering an empty/relative href. Idempotent upsert.
 */
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate } = require('./utils/templates/email/invoices/paymentReceived.cjs');

exports.up = async function up(knex) {
  await upsertEmailTemplate(knex, getTemplate());
};

exports.down = async function down() {
  // No-op: email template migrations are forward-only content corrections.
};
