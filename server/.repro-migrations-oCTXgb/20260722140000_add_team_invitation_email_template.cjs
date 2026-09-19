/**
 * Seed the team-invitation email notification subtype and template, used by
 * the new internal-team-member email invite flow (onboarding step 2 and
 * Settings > Users), mirroring portal-invitation for internal users.
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: teamInvitation } = require('./utils/templates/email/auth/teamInvitation.cjs');

exports.up = async function(knex) {
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, teamInvitation());
};

exports.down = async function(knex) {
  await knex('system_email_templates').where('name', 'team-invitation').delete();
  await knex('notification_subtypes').where('name', 'team-invitation').delete();
};
