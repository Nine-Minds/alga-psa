/**
 * Board notification rules: templates for the "client replied on an unassigned ticket" trigger
 * (2026-11-20, alga-2026-0003350).
 *
 * Creates:
 * - Internal notification subtype + template: ticket-board-client-reply-unassigned (9 languages)
 * - Email notification subtype: Board Client Reply Unassigned
 * - Email template: ticket-board-client-reply-unassigned (9 languages)
 *
 * A separate subtype from the other board triggers (and from the plain comment notification), so a
 * tech can mute unassigned-queue alerts without muting their own ticket notifications.
 *
 * Upsert semantics throughout (merge by (name, language_code)), so the migration is idempotent.
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { TEMPLATES: TICKET_TEMPLATES } = require('./utils/templates/internal/tickets.cjs');
const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate, deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const {
  TEMPLATE_NAME: EMAIL_TEMPLATE_NAME,
  SUBTYPE_NAME: EMAIL_SUBTYPE_NAME,
  getTemplate: ticketBoardClientReplyUnassignedEmail,
} = require('./utils/templates/email/tickets/ticketBoardClientReplyUnassigned.cjs');

const INTERNAL_NAME = 'ticket-board-client-reply-unassigned';

exports.up = async function up(knex) {
  await upsertCategoriesAndSubtypes(knex);
  await upsertInternalTemplates(
    knex,
    TICKET_TEMPLATES.filter((template) => template.templateName === INTERNAL_NAME)
  );

  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, ticketBoardClientReplyUnassignedEmail());
};

exports.down = async function down(knex) {
  await deleteEmailTemplate(knex, EMAIL_TEMPLATE_NAME);
  await knex('notification_subtypes').where({ name: EMAIL_SUBTYPE_NAME }).del();
  await knex('internal_notification_templates').where({ name: INTERNAL_NAME }).del();
  await knex('internal_notification_subtypes').where({ name: INTERNAL_NAME }).del();
};
