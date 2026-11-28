/**
 * Refresh the stock client ticket-created template to omit the description
 * for email-created tickets, avoiding repeated inbound text in the reply.
 */
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate } = require('./utils/templates/email/tickets/ticketCreatedClient.cjs');

exports.up = async function up(knex) {
  await upsertEmailTemplate(knex, getTemplate());
};

exports.down = async function down() {
  // No-op: email template migrations are forward-only content corrections.
};
