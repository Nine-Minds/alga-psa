/**
 * New Ticket on Board email: render the Description box from the sanitised HTML
 * rendition (`ticket.descriptionHtml`) so table-based inbound emails show as
 * tables (alga-2026-0003184).
 *
 * Editing a template module changes nothing in a deployed database, so this
 * re-upserts `ticket-board-created` into system_email_templates (every language
 * the module produces). Tenant-customised rows (tenant_email_templates) are not
 * touched. Upsert semantics (merge by (name, language_code)) make it idempotent.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { getTemplate } = require('./utils/templates/email/tickets/ticketBoardCreated.cjs');

  await upsertEmailTemplate(knex, getTemplate());
  console.log('  ✓ ticket-board-created email template upserted');
};

/**
 * No-op: the previous template body is not recoverable from source, and the
 * upserted template is a superset-safe replacement.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function () {};
