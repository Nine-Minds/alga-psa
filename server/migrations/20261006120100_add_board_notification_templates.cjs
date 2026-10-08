/**
 * Add board notification rule templates.
 *
 * Creates:
 * - Internal notification subtypes: ticket-board-created, ticket-board-status-entered
 * - Internal notification templates for each subtype (9 languages)
 * - Email notification subtypes: Board Ticket Created, Board Ticket Status Entered
 * - Email templates: ticket-board-created, ticket-board-status-entered (9 languages)
 *
 * These are separate from the assignment templates so a tech can mute queue
 * alerts without muting their own assignment notifications.
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { TEMPLATES: TICKET_TEMPLATES } = require('./utils/templates/internal/tickets.cjs');
const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: ticketBoardCreatedEmail } = require('./utils/templates/email/tickets/ticketBoardCreated.cjs');
const { getTemplate: ticketBoardStatusEnteredEmail } = require('./utils/templates/email/tickets/ticketBoardStatusEntered.cjs');

const INTERNAL_NAMES = ['ticket-board-created', 'ticket-board-status-entered'];
const EMAIL_TEMPLATE_NAMES = ['ticket-board-created', 'ticket-board-status-entered'];
const EMAIL_SUBTYPE_NAMES = ['Board Ticket Created', 'Board Ticket Status Entered'];

exports.up = async function up(knex) {
  await upsertCategoriesAndSubtypes(knex);

  const boardTemplates = TICKET_TEMPLATES.filter((t) => INTERNAL_NAMES.includes(t.templateName));
  await upsertInternalTemplates(knex, boardTemplates);

  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, ticketBoardCreatedEmail());
  await upsertEmailTemplate(knex, ticketBoardStatusEnteredEmail());
};

exports.down = async function down(knex) {
  await knex('system_email_templates').whereIn('name', EMAIL_TEMPLATE_NAMES).delete();
  await knex('notification_subtypes').whereIn('name', EMAIL_SUBTYPE_NAMES).delete();
  await knex('internal_notification_templates').whereIn('name', INTERNAL_NAMES).delete();
  await knex('internal_notification_subtypes').whereIn('name', INTERNAL_NAMES).delete();
};
