/**
 * Client-facing ticket comment-added / closed email templates (2026-11-15):
 *
 * Introduces the `ticket-comment-added-client` and `ticket-closed-client` email
 * templates, each with its own notification subtype ('Ticket Comment Added
 * Client', 'Ticket Closed Client'), following the 2026-06-09 split of the
 * created/updated emails.
 *
 * Previously the same ticket-comment-added / ticket-closed template went to
 * both MSP staff and the client side. The paired code change routes the client
 * rendering to these variants (TICKET_EMAIL_CLIENT_VARIANTS in
 * packages/notifications/src/lib/templateVariables/ticketEmailAudience.ts).
 *
 * This migration only adds the stock templates and subtypes. What each tenant
 * had set up for the shared email (its own template rows, a switched-off
 * subtype, user opt-outs) is copied to the client names by
 * 20261115121000, after which the two emails are separate.
 *
 * Upsert semantics throughout (merge by (name, language_code)), so the
 * migration is idempotent and safe to re-run.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { getTemplate: getTicketCommentAddedClient } = require('./utils/templates/email/tickets/ticketCommentAddedClient.cjs');
  const { getTemplate: getTicketClosedClient } = require('./utils/templates/email/tickets/ticketClosedClient.cjs');

  // Ensures the 'Ticket Comment Added Client' and 'Ticket Closed Client'
  // subtypes exist (added to the shared source-of-truth SUBTYPES list).
  await upsertEmailCategoriesAndSubtypes(knex);

  await upsertEmailTemplate(knex, getTicketCommentAddedClient());
  console.log('  ✓ ticket-comment-added-client email template upserted');

  await upsertEmailTemplate(knex, getTicketClosedClient());
  console.log('  ✓ ticket-closed-client email template upserted');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const { deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

  await deleteEmailTemplate(knex, 'ticket-comment-added-client');
  await deleteEmailTemplate(knex, 'ticket-closed-client');

  await knex('notification_subtypes')
    .whereIn('name', ['Ticket Comment Added Client', 'Ticket Closed Client'])
    .del();
};
