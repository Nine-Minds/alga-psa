/**
 * Re-upsert email templates whose "Changes Made" box now emits HTML
 * instead of plain text with \n separators. Picks up the latest content
 * from the source-of-truth files.
 */

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

const { getTemplate: ticketUpdated } = require('./utils/templates/email/tickets/ticketUpdated.cjs');
const { getTemplate: projectUpdated } = require('./utils/templates/email/projects/projectUpdated.cjs');
const { getTemplate: projectClosed } = require('./utils/templates/email/projects/projectClosed.cjs');

const TEMPLATES = [ticketUpdated, projectUpdated, projectClosed];

exports.up = async function (knex) {
  for (const getter of TEMPLATES) {
    await upsertEmailTemplate(knex, getter());
  }
};

exports.down = async function () {
  // No-op: prior content is reproducible by running the consolidation migration.
};
