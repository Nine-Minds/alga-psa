/**
 * Ticket auto-close warning email template (2026-06-10).
 *
 * Adds the 'Ticket Auto-Close Warning' notification subtype (Tickets
 * category) and the ticket-auto-close-warning email template sent to the
 * ticket's primary contact before an auto-close rule closes the ticket for
 * inactivity. The warn phase of the auto-close job gates delivery on this
 * subtype via sendNotificationIfEnabled.
 *
 * Upsert semantics (merge by (name, language_code)) — idempotent.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { getTemplate } = require('./utils/templates/email/tickets/ticketAutoCloseWarning.cjs');

  // Ensures the 'Ticket Auto-Close Warning' subtype exists (added to the
  // shared source-of-truth SUBTYPES list).
  await upsertEmailCategoriesAndSubtypes(knex);

  await upsertEmailTemplate(knex, getTemplate());
  console.log('  ✓ ticket-auto-close-warning email template upserted');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const { deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

  await deleteEmailTemplate(knex, 'ticket-auto-close-warning');

  await knex('notification_subtypes')
    .where({ name: 'Ticket Auto-Close Warning' })
    .del();
};
