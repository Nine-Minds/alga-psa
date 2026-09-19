/**
 * Add team assignment notification subtypes and templates,
 * and fix email template brand colors.
 *
 * Creates:
 * - Internal notification subtypes: ticket-team-assigned, task-team-assigned
 * - Internal notification templates for each subtype (7 languages)
 * - Email notification subtype: Ticket Team Assigned
 * - Email template: ticket-team-assigned (7 languages, client-facing)
 *
 * Fixes brand colors in 5 source-of-truth email templates:
 * - projectTaskAssignedPrimary: green (#10b981) button → brand purple (#8A4DEA)
 * - emailVerification: blue (#3b82f6) theme → brand purple/cyan
 * - noAccountFound: legacy gradient (#667eea→#764ba2) → brand gradient
 * - tenantRecovery: legacy gradient (#667eea→#764ba2) → brand gradient
 * - portalInvitation: purple-only gradient → brand gradient with cyan
 *
 * Uses the shared source-of-truth template pattern.
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { TEMPLATES: TICKET_TEMPLATES } = require('./utils/templates/internal/tickets.cjs');
const { TEMPLATES: PROJECT_TEMPLATES } = require('./utils/templates/internal/projects.cjs');
const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: ticketTeamAssignedEmail } = require('./utils/templates/email/tickets/ticketTeamAssigned.cjs');

// Brand-color-fix templates
const { getTemplate: projectTaskPrimary } = require('./utils/templates/email/projects/projectTaskAssignedPrimary.cjs');
const { getTemplate: emailVerification } = require('./utils/templates/email/auth/emailVerification.cjs');
const { getTemplate: noAccountFound } = require('./utils/templates/email/auth/noAccountFound.cjs');
const { getTemplate: tenantRecovery } = require('./utils/templates/email/auth/tenantRecovery.cjs');
const { getTemplate: portalInvitation } = require('./utils/templates/email/auth/portalInvitation.cjs');

const BRAND_FIX_TEMPLATES = [projectTaskPrimary, emailVerification, noAccountFound, tenantRecovery, portalInvitation];

exports.up = async function(knex) {
  console.log('Adding team assignment notification subtypes and templates...');

  // 1. Upsert all internal notification categories & subtypes (including new team ones)
  await upsertCategoriesAndSubtypes(knex);
  console.log('  ✓ Internal categories & subtypes upserted');

  // 2. Upsert ticket internal templates (includes ticket-team-assigned)
  await upsertInternalTemplates(knex, TICKET_TEMPLATES);
  console.log(`  ✓ ${TICKET_TEMPLATES.length} ticket internal notification templates upserted`);

  // 3. Upsert project internal templates (includes task-team-assigned)
  await upsertInternalTemplates(knex, PROJECT_TEMPLATES);
  console.log(`  ✓ ${PROJECT_TEMPLATES.length} project internal notification templates upserted`);

  // 4. Upsert email notification categories & subtypes (includes Ticket Team Assigned)
  await upsertEmailCategoriesAndSubtypes(knex);
  console.log('  ✓ Email categories & subtypes upserted');

  // 5. Upsert team assignment email template (client-facing)
  await upsertEmailTemplate(knex, ticketTeamAssignedEmail());
  console.log('  ✓ ticket-team-assigned email template upserted');

  // 6. Re-upsert templates with fixed brand colors
  for (const getter of BRAND_FIX_TEMPLATES) {
    const def = getter();
    await upsertEmailTemplate(knex, def);
    console.log(`  ✓ ${def.templateName} brand colors fixed`);
  }

  console.log('Successfully added team assignment notification templates and fixed brand colors');
};

exports.down = async function(knex) {
  console.log('Removing team assignment notification templates...');

  // Delete email template
  await knex('system_email_templates')
    .where('name', 'ticket-team-assigned')
    .delete();

  // Delete email subtype
  await knex('notification_subtypes')
    .where('name', 'Ticket Team Assigned')
    .delete();

  // Delete internal notification templates
  await knex('internal_notification_templates')
    .whereIn('name', [
      'ticket-team-assigned',
      'task-team-assigned'
    ])
    .delete();

  // Delete internal notification subtypes
  await knex('internal_notification_subtypes')
    .whereIn('name', [
      'ticket-team-assigned',
      'task-team-assigned'
    ])
    .delete();

  console.log('Successfully removed team assignment notification templates');
};
