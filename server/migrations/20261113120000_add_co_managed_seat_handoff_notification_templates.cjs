/**
 * Co-managed seat handoff notifications (in-app).
 *
 * Creates the internal notification subtypes and templates (9 languages) for a ticket handed
 * to client IT and a ticket handed to the MSP:
 * - ticket-handed-to-client-it
 * - ticket-handed-to-msp
 *
 * Separate subtypes, so a user can mute handoff notices without muting assignments.
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { TEMPLATES: TICKET_TEMPLATES } = require('./utils/templates/internal/tickets.cjs');

const INTERNAL_NAMES = ['ticket-handed-to-client-it', 'ticket-handed-to-msp'];

exports.up = async function up(knex) {
  await upsertCategoriesAndSubtypes(knex);
  await upsertInternalTemplates(knex, TICKET_TEMPLATES.filter((t) => INTERNAL_NAMES.includes(t.templateName)));
};

exports.down = async function down(knex) {
  await knex('internal_notification_templates').whereIn('name', INTERNAL_NAMES).delete();
  await knex('internal_notification_subtypes').whereIn('name', INTERNAL_NAMES).delete();
};
