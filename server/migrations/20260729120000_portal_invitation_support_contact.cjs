/**
 * Re-upsert the portal-invitation email template so the subject, footer and
 * "Need Assistance?" box reference the MSP (tenantName / supportEmail /
 * supportPhone) instead of the recipient's own client company and contact
 * details. Picks up the latest content from the source-of-truth file.
 */

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');

const { getTemplate: authPortalInvitation } = require('./utils/templates/email/auth/portalInvitation.cjs');

exports.up = async function (knex) {
  await upsertEmailTemplate(knex, authPortalInvitation());
};

exports.down = async function () {
  // No-op: prior content is reproducible by running the consolidation migration.
};
