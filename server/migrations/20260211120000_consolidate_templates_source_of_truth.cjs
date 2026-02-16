/**
 * Consolidation migration: upsert all email and internal notification
 * templates from the source-of-truth files.
 *
 * This migration is idempotent — safe to run on both fresh and existing
 * databases. It ensures every category, subtype, and template variant
 * is present and up-to-date.
 *
 * After this migration, template content lives in:
 *   server/migrations/utils/templates/email/   (email templates)
 *   server/migrations/utils/templates/internal/ (internal notification templates)
 *
 * Future template changes only need to:
 *   1. Edit the source file
 *   2. Write a small migration that re-imports and upserts
 */

// ── Shared utilities ──────────────────────────────────────────────
const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');

// ── Email template source files ───────────────────────────────────
// Auth
const { getTemplate: authPasswordReset } = require('./utils/templates/email/auth/passwordReset.cjs');
const { getTemplate: authEmailVerification } = require('./utils/templates/email/auth/emailVerification.cjs');
const { getTemplate: authPortalInvitation } = require('./utils/templates/email/auth/portalInvitation.cjs');
const { getTemplate: authTenantRecovery } = require('./utils/templates/email/auth/tenantRecovery.cjs');
const { getTemplate: authNoAccountFound } = require('./utils/templates/email/auth/noAccountFound.cjs');

// Tickets
const { getTemplate: ticketCreated } = require('./utils/templates/email/tickets/ticketCreated.cjs');
const { getTemplate: ticketAssigned } = require('./utils/templates/email/tickets/ticketAssigned.cjs');
const { getTemplate: ticketUpdated } = require('./utils/templates/email/tickets/ticketUpdated.cjs');
const { getTemplate: ticketClosed } = require('./utils/templates/email/tickets/ticketClosed.cjs');
const { getTemplate: ticketCommentAdded } = require('./utils/templates/email/tickets/ticketCommentAdded.cjs');

// Invoices
const { getTemplate: invoiceGenerated } = require('./utils/templates/email/invoices/invoiceGenerated.cjs');
const { getTemplate: invoiceEmail } = require('./utils/templates/email/invoices/invoiceEmail.cjs');
const { getTemplate: paymentReceived } = require('./utils/templates/email/invoices/paymentReceived.cjs');
const { getTemplate: paymentOverdue } = require('./utils/templates/email/invoices/paymentOverdue.cjs');

// Billing
const { getTemplate: creditExpiration } = require('./utils/templates/email/billing/creditExpiration.cjs');

// Projects
const { getTemplate: projectCreated } = require('./utils/templates/email/projects/projectCreated.cjs');
const { getTemplate: projectUpdated } = require('./utils/templates/email/projects/projectUpdated.cjs');
const { getTemplate: projectClosed } = require('./utils/templates/email/projects/projectClosed.cjs');
const { getTemplate: projectAssigned } = require('./utils/templates/email/projects/projectAssigned.cjs');
const { getTemplate: projectTaskPrimary } = require('./utils/templates/email/projects/projectTaskAssignedPrimary.cjs');
const { getTemplate: projectTaskAdditional } = require('./utils/templates/email/projects/projectTaskAssignedAdditional.cjs');
const { getTemplate: taskUpdated } = require('./utils/templates/email/projects/taskUpdated.cjs');
const { getTemplate: milestoneCompleted } = require('./utils/templates/email/projects/milestoneCompleted.cjs');

// Appointments
const { getTemplate: apptReceived } = require('./utils/templates/email/appointments/appointmentRequestReceived.cjs');
const { getTemplate: apptApproved } = require('./utils/templates/email/appointments/appointmentRequestApproved.cjs');
const { getTemplate: apptDeclined } = require('./utils/templates/email/appointments/appointmentRequestDeclined.cjs');
const { getTemplate: apptNew } = require('./utils/templates/email/appointments/newAppointmentRequest.cjs');

// Time
const { getTemplate: timeSubmitted } = require('./utils/templates/email/time/timeEntrySubmitted.cjs');
const { getTemplate: timeApproved } = require('./utils/templates/email/time/timeEntryApproved.cjs');
const { getTemplate: timeRejected } = require('./utils/templates/email/time/timeEntryRejected.cjs');

// Surveys
const { getTemplate: surveyTicketClosed } = require('./utils/templates/email/surveys/surveyTicketClosed.cjs');

// ── Internal notification template source files ───────────────────
const { TEMPLATES: internalTickets } = require('./utils/templates/internal/tickets.cjs');
const { TEMPLATES: internalProjects } = require('./utils/templates/internal/projects.cjs');
const { TEMPLATES: internalInvoices } = require('./utils/templates/internal/invoices.cjs');
const { TEMPLATES: internalSystem } = require('./utils/templates/internal/system.cjs');
const { TEMPLATES: internalAppointments } = require('./utils/templates/internal/appointments.cjs');

// ── Collect all email template getters ────────────────────────────
const EMAIL_TEMPLATES = [
  // Auth
  authPasswordReset,
  authEmailVerification,
  authPortalInvitation,
  authTenantRecovery,
  authNoAccountFound,
  // Tickets
  ticketCreated,
  ticketAssigned,
  ticketUpdated,
  ticketClosed,
  ticketCommentAdded,
  // Invoices
  invoiceGenerated,
  invoiceEmail,
  paymentReceived,
  paymentOverdue,
  // Billing
  creditExpiration,
  // Projects
  projectCreated,
  projectUpdated,
  projectClosed,
  projectAssigned,
  projectTaskPrimary,
  projectTaskAdditional,
  taskUpdated,
  milestoneCompleted,
  // Appointments
  apptReceived,
  apptApproved,
  apptDeclined,
  apptNew,
  // Time
  timeSubmitted,
  timeApproved,
  timeRejected,
  // Surveys
  surveyTicketClosed,
];

const INTERNAL_TEMPLATES = [
  ...internalTickets,
  ...internalProjects,
  ...internalInvoices,
  ...internalSystem,
  ...internalAppointments,
];

// ──────────────────────────────────────────────────────────────────

exports.up = async function (knex) {
  console.log('Consolidating all templates from source-of-truth files...');

  // 1. Ensure email notification categories + subtypes exist
  await upsertEmailCategoriesAndSubtypes(knex);
  console.log('  ✓ Email categories & subtypes upserted');

  // 2. Upsert all email templates
  let emailCount = 0;
  for (const getter of EMAIL_TEMPLATES) {
    const def = getter();
    await upsertEmailTemplate(knex, def);
    emailCount++;
  }
  console.log(`  ✓ ${emailCount} email templates upserted`);

  // 3. Ensure internal notification categories + subtypes exist
  await upsertCategoriesAndSubtypes(knex);
  console.log('  ✓ Internal categories & subtypes upserted');

  // 4. Upsert all internal notification templates
  await upsertInternalTemplates(knex, INTERNAL_TEMPLATES);
  console.log(`  ✓ ${INTERNAL_TEMPLATES.length} internal notification templates upserted`);

  console.log('Template consolidation complete.');
};

exports.down = async function () {
  // No-op: prior migrations contain the old template content.
  // Rolling back this migration simply leaves the templates as they were.
};
