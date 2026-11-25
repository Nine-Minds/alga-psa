/**
 * New Ticket (ticket-created) email: render the Description box of the internal
 * (MSP) rendering from the sanitised HTML rendition (`ticket.descriptionHtml`)
 * so table-based inbound emails show as tables for watchers, the assignee and
 * board-rule users who also watch the ticket (alga-2026-0003184).
 *
 * Editing a template module changes nothing in a deployed database, so this
 * re-upserts `ticket-created` into system_email_templates (every language the
 * module produces). Tenant-customised rows (tenant_email_templates) are not
 * touched. `ticket-created-client` is not re-upserted. Upsert semantics (merge
 * by (name, language_code)) make it idempotent.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { getTemplate } = require('./utils/templates/email/tickets/ticketCreated.cjs');

  await upsertEmailTemplate(knex, getTemplate());
  console.log('  ✓ ticket-created email template upserted');
};

/**
 * No-op: the previous template body is not recoverable from source, and the
 * upserted template is a superset-safe replacement.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function () {};
