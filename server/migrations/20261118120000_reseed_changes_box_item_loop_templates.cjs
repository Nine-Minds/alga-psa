/**
 * Re-upsert the update emails whose "Changes Made" box now lays out
 * {{#each ticket.changeItems}} / {{#each project.changeItems}} itself instead of
 * dropping in the subscriber's pre-rendered {{{ticket.changes}}} HTML.
 *
 * The box's colors now live in the template and use the brand palette (the ticket
 * box was amber), so a tenant's email branding restyles it. Tenant copies are not
 * touched: hand-edited ones keep working because the subscriber still fills
 * ticket.changes / project.changes, and copies the branding tool wrote pick up the
 * new box on the tenant's next apply.
 */

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

const { getTemplate: ticketUpdated } = require('./utils/templates/email/tickets/ticketUpdated.cjs');
const { getTemplate: ticketUpdatedClient } = require('./utils/templates/email/tickets/ticketUpdatedClient.cjs');
const { getTemplate: projectUpdated } = require('./utils/templates/email/projects/projectUpdated.cjs');
const { getTemplate: projectClosed } = require('./utils/templates/email/projects/projectClosed.cjs');

const TEMPLATES = [ticketUpdated, ticketUpdatedClient, projectUpdated, projectClosed];

exports.up = async function (knex) {
  for (const getter of TEMPLATES) {
    await upsertEmailTemplate(knex, getter());
  }
};

exports.down = async function () {
  // No-op: prior content is reproducible from the source-of-truth files at the previous revision.
};
