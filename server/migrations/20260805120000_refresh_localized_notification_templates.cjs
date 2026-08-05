/**
 * Refresh localized notification templates from source-of-truth files.
 *
 * The 2026-08 localization sweep fixed the non-English variants of these
 * templates: raw-HTML placeholders that had drifted to the escaping form
 * ({{ticket.description}} -> {{{ticket.description}}}), the missing
 * {{commentPreview}} in the internal ticket-comment message, register and
 * terminology corrections (nl je->u and e-mail spelling, it board->bacheca and
 * milestone->traguardo, fr assignation->attribution, es usted), and Handlebars
 * block structure realigned with the English variants. Re-upserting delivers
 * the corrected content to existing installations.
 */

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');

const EMAIL_TEMPLATE_SOURCES = [
  './utils/templates/email/appointments/appointmentRequestApproved.cjs',
  './utils/templates/email/auth/emailVerification.cjs',
  './utils/templates/email/auth/portalInvitation.cjs',
  './utils/templates/email/auth/tenantRecovery.cjs',
  './utils/templates/email/invoices/invoiceGenerated.cjs',
  './utils/templates/email/invoices/paymentOverdue.cjs',
  './utils/templates/email/invoices/paymentReceived.cjs',
  './utils/templates/email/opportunities/opportunityWeeklyDigest.cjs',
  './utils/templates/email/projects/milestoneCompleted.cjs',
  './utils/templates/email/projects/projectMilestoneReady.cjs',
  './utils/templates/email/projects/projectTaskAssignedAdditional.cjs',
  './utils/templates/email/projects/projectTaskAssignedPrimary.cjs',
  './utils/templates/email/rmm/rmmAlertTriggered.cjs',
  './utils/templates/email/surveys/surveyTicketClosed.cjs',
  './utils/templates/email/tickets/ticketAgentAssignedClient.cjs',
  './utils/templates/email/tickets/ticketAssigned.cjs',
  './utils/templates/email/tickets/ticketClosed.cjs',
  './utils/templates/email/tickets/ticketCommentAdded.cjs',
  './utils/templates/email/tickets/ticketCreated.cjs',
  './utils/templates/email/tickets/ticketCreatedClient.cjs',
  './utils/templates/email/tickets/ticketTeamAssigned.cjs',
  './utils/templates/email/tickets/ticketUpdated.cjs',
];

const INTERNAL_TEMPLATE_SOURCES = [
  './utils/templates/internal/projects.cjs',
  './utils/templates/internal/system.cjs',
  './utils/templates/internal/tickets.cjs',
];

exports.up = async function up(knex) {
  for (const source of EMAIL_TEMPLATE_SOURCES) {
    const { getTemplate } = require(source);
    // skipMissingSubtype: appliance tenants may lack optional feature subtypes;
    // a content refresh must never abort their migration chain.
    await upsertEmailTemplate(knex, getTemplate(), { skipMissingSubtype: true });
  }

  for (const source of INTERNAL_TEMPLATE_SOURCES) {
    const { TEMPLATES } = require(source);
    await upsertInternalTemplates(knex, TEMPLATES, { skipMissingSubtype: true });
  }
};

exports.down = async function down() {
  // Content-only refresh of existing rows; there is no previous content to
  // restore from source. Rolling back the deploy re-runs the prior upserts.
};
