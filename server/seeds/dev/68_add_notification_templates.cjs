/**
 * Seed: Upsert all email templates from source-of-truth files.
 *
 * Replaces the previous hand-coded template content with imports from
 * server/migrations/utils/templates/email/. Templates are upserted (not
 * deleted first), so tenant customisations are not lost.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const { upsertEmailCategoriesAndSubtypes } = require('../../migrations/utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('../../migrations/utils/templates/_shared/upsertEmailTemplates.cjs');

// ── Email template source files ───────────────────────────────────
// Auth
const { getTemplate: authPasswordReset } = require('../../migrations/utils/templates/email/auth/passwordReset.cjs');
const { getTemplate: authEmailVerification } = require('../../migrations/utils/templates/email/auth/emailVerification.cjs');
const { getTemplate: authPortalInvitation } = require('../../migrations/utils/templates/email/auth/portalInvitation.cjs');
const { getTemplate: authTenantRecovery } = require('../../migrations/utils/templates/email/auth/tenantRecovery.cjs');
const { getTemplate: authNoAccountFound } = require('../../migrations/utils/templates/email/auth/noAccountFound.cjs');

// Tickets
const { getTemplate: ticketCreated } = require('../../migrations/utils/templates/email/tickets/ticketCreated.cjs');
const { getTemplate: ticketAssigned } = require('../../migrations/utils/templates/email/tickets/ticketAssigned.cjs');
const { getTemplate: ticketUpdated } = require('../../migrations/utils/templates/email/tickets/ticketUpdated.cjs');
const { getTemplate: ticketClosed } = require('../../migrations/utils/templates/email/tickets/ticketClosed.cjs');
const { getTemplate: ticketCommentAdded } = require('../../migrations/utils/templates/email/tickets/ticketCommentAdded.cjs');

// Invoices
const { getTemplate: invoiceGenerated } = require('../../migrations/utils/templates/email/invoices/invoiceGenerated.cjs');
const { getTemplate: invoiceEmail } = require('../../migrations/utils/templates/email/invoices/invoiceEmail.cjs');
const { getTemplate: paymentReceived } = require('../../migrations/utils/templates/email/invoices/paymentReceived.cjs');
const { getTemplate: paymentOverdue } = require('../../migrations/utils/templates/email/invoices/paymentOverdue.cjs');

// Billing
const { getTemplate: creditExpiration } = require('../../migrations/utils/templates/email/billing/creditExpiration.cjs');

// Projects
const { getTemplate: projectCreated } = require('../../migrations/utils/templates/email/projects/projectCreated.cjs');
const { getTemplate: projectUpdated } = require('../../migrations/utils/templates/email/projects/projectUpdated.cjs');
const { getTemplate: projectClosed } = require('../../migrations/utils/templates/email/projects/projectClosed.cjs');
const { getTemplate: projectAssigned } = require('../../migrations/utils/templates/email/projects/projectAssigned.cjs');
const { getTemplate: projectTaskPrimary } = require('../../migrations/utils/templates/email/projects/projectTaskAssignedPrimary.cjs');
const { getTemplate: projectTaskAdditional } = require('../../migrations/utils/templates/email/projects/projectTaskAssignedAdditional.cjs');
const { getTemplate: taskUpdated } = require('../../migrations/utils/templates/email/projects/taskUpdated.cjs');
const { getTemplate: milestoneCompleted } = require('../../migrations/utils/templates/email/projects/milestoneCompleted.cjs');

// Appointments
const { getTemplate: apptReceived } = require('../../migrations/utils/templates/email/appointments/appointmentRequestReceived.cjs');
const { getTemplate: apptApproved } = require('../../migrations/utils/templates/email/appointments/appointmentRequestApproved.cjs');
const { getTemplate: apptDeclined } = require('../../migrations/utils/templates/email/appointments/appointmentRequestDeclined.cjs');
const { getTemplate: apptNew } = require('../../migrations/utils/templates/email/appointments/newAppointmentRequest.cjs');
const { getTemplate: apptAssignedTech } = require('../../migrations/utils/templates/email/appointments/appointmentAssignedTechnician.cjs');

// Time
const { getTemplate: timeSubmitted } = require('../../migrations/utils/templates/email/time/timeEntrySubmitted.cjs');
const { getTemplate: timeApproved } = require('../../migrations/utils/templates/email/time/timeEntryApproved.cjs');
const { getTemplate: timeRejected } = require('../../migrations/utils/templates/email/time/timeEntryRejected.cjs');

// Surveys
const { getTemplate: surveyTicketClosed } = require('../../migrations/utils/templates/email/surveys/surveyTicketClosed.cjs');

// ── Collect all template getters ──────────────────────────────────
const TEMPLATE_GETTERS = [
  authPasswordReset,
  authEmailVerification,
  authPortalInvitation,
  authTenantRecovery,
  authNoAccountFound,
  ticketCreated,
  ticketAssigned,
  ticketUpdated,
  ticketClosed,
  ticketCommentAdded,
  invoiceGenerated,
  invoiceEmail,
  paymentReceived,
  paymentOverdue,
  creditExpiration,
  projectCreated,
  projectUpdated,
  projectClosed,
  projectAssigned,
  projectTaskPrimary,
  projectTaskAdditional,
  taskUpdated,
  milestoneCompleted,
  apptReceived,
  apptApproved,
  apptDeclined,
  apptNew,
  apptAssignedTech,
  timeSubmitted,
  timeApproved,
  timeRejected,
  surveyTicketClosed,
];

exports.seed = async function (knex) {
  console.log('Seed 68: Upserting all email templates from source-of-truth files...');

  // Ensure categories + subtypes exist
  await upsertEmailCategoriesAndSubtypes(knex);

  // Upsert every email template (all languages)
  let count = 0;
  for (const getter of TEMPLATE_GETTERS) {
    await upsertEmailTemplate(knex, getter(), { skipMissingSubtype: true });
    count++;
  }

  console.log(`Seed 68: ${count} email templates upserted.`);
};
