/**
 * Client-facing ticket created/updated email templates (2026-06-09):
 *
 * Introduces the `ticket-created-client` and `ticket-updated-client` email
 * templates, each with its own notification subtype ('Ticket Created Client',
 * 'Ticket Updated Client') so tenants can gate client-facing emails
 * independently of the MSP-internal 'Ticket Created' / 'Ticket Updated'
 * subtypes.
 *
 * Previously the same ticket-created / ticket-updated template went to both
 * the MSP staff and the client contact (only the URL differed). The paired
 * subscriber change in
 * server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts routes the
 * primary contact and external watchers to these client variants, which drop
 * MSP-internal details (assignee email, requester contact block,
 * board/category/location rows).
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
  const { getTemplate: getTicketCreatedClient } = require('./utils/templates/email/tickets/ticketCreatedClient.cjs');
  const { getTemplate: getTicketUpdatedClient } = require('./utils/templates/email/tickets/ticketUpdatedClient.cjs');

  // Ensures the 'Ticket Created Client' and 'Ticket Updated Client' subtypes
  // exist (added to the shared source-of-truth SUBTYPES list).
  await upsertEmailCategoriesAndSubtypes(knex);

  await upsertEmailTemplate(knex, getTicketCreatedClient());
  console.log('  ✓ ticket-created-client email template upserted');

  await upsertEmailTemplate(knex, getTicketUpdatedClient());
  console.log('  ✓ ticket-updated-client email template upserted');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const { deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

  await deleteEmailTemplate(knex, 'ticket-created-client');
  await deleteEmailTemplate(knex, 'ticket-updated-client');

  await knex('notification_subtypes')
    .whereIn('name', ['Ticket Created Client', 'Ticket Updated Client'])
    .del();
};
