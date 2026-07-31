/**
 * Add Brazilian Portuguese email templates.
 *
 * Mirrors the dev seed's source-of-truth email template list and only upserts
 * the `pt` variants. Idempotent via (name, language_code).
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');

// Auth
const { getTemplate: authPasswordReset } = require('./utils/templates/email/auth/passwordReset.cjs');
const { getTemplate: authEmailVerification } = require('./utils/templates/email/auth/emailVerification.cjs');
const { getTemplate: authPortalInvitation } = require('./utils/templates/email/auth/portalInvitation.cjs');
const { getTemplate: authTenantRecovery } = require('./utils/templates/email/auth/tenantRecovery.cjs');
const { getTemplate: authNoAccountFound } = require('./utils/templates/email/auth/noAccountFound.cjs');

// Tickets
const { getTemplate: ticketCreated } = require('./utils/templates/email/tickets/ticketCreated.cjs');
const { getTemplate: ticketCreatedClient } = require('./utils/templates/email/tickets/ticketCreatedClient.cjs');
const { getTemplate: ticketAssigned } = require('./utils/templates/email/tickets/ticketAssigned.cjs');
const { getTemplate: ticketUpdated } = require('./utils/templates/email/tickets/ticketUpdated.cjs');
const { getTemplate: ticketUpdatedClient } = require('./utils/templates/email/tickets/ticketUpdatedClient.cjs');
const { getTemplate: ticketClosed } = require('./utils/templates/email/tickets/ticketClosed.cjs');
const { getTemplate: ticketCommentAdded } = require('./utils/templates/email/tickets/ticketCommentAdded.cjs');
const { getTemplate: ticketAgentAssignedClient } = require('./utils/templates/email/tickets/ticketAgentAssignedClient.cjs');
const { getTemplate: ticketAutoCloseWarning } = require('./utils/templates/email/tickets/ticketAutoCloseWarning.cjs');
const { getTemplate: ticketTeamAssigned } = require('./utils/templates/email/tickets/ticketTeamAssigned.cjs');

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
const { getTemplate: taskCommentAdded } = require('./utils/templates/email/projects/taskCommentAdded.cjs');

// Appointments
const { getTemplate: apptReceived } = require('./utils/templates/email/appointments/appointmentRequestReceived.cjs');
const { getTemplate: apptApproved } = require('./utils/templates/email/appointments/appointmentRequestApproved.cjs');
const { getTemplate: apptDeclined } = require('./utils/templates/email/appointments/appointmentRequestDeclined.cjs');
const { getTemplate: apptNew } = require('./utils/templates/email/appointments/newAppointmentRequest.cjs');
const { getTemplate: apptAssignedTech } = require('./utils/templates/email/appointments/appointmentAssignedTechnician.cjs');

// Time
const { getTemplate: timeSubmitted } = require('./utils/templates/email/time/timeEntrySubmitted.cjs');
const { getTemplate: timeApproved } = require('./utils/templates/email/time/timeEntryApproved.cjs');
const { getTemplate: timeRejected } = require('./utils/templates/email/time/timeEntryRejected.cjs');

// Surveys
const { getTemplate: surveyTicketClosed } = require('./utils/templates/email/surveys/surveyTicketClosed.cjs');

// SLA
const { getTemplate: slaWarning } = require('./utils/templates/email/sla/slaWarning.cjs');
const { getTemplate: slaBreach } = require('./utils/templates/email/sla/slaBreach.cjs');
const { getTemplate: slaEscalation } = require('./utils/templates/email/sla/slaEscalation.cjs');

const TEMPLATE_GETTERS = [
  authPasswordReset,
  authEmailVerification,
  authPortalInvitation,
  authTenantRecovery,
  authNoAccountFound,
  ticketCreated,
  ticketCreatedClient,
  ticketAssigned,
  ticketUpdated,
  ticketUpdatedClient,
  ticketClosed,
  ticketCommentAdded,
  ticketAgentAssignedClient,
  ticketAutoCloseWarning,
  ticketTeamAssigned,
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
  taskCommentAdded,
  apptReceived,
  apptApproved,
  apptDeclined,
  apptNew,
  apptAssignedTech,
  timeSubmitted,
  timeApproved,
  timeRejected,
  surveyTicketClosed,
  slaWarning,
  slaBreach,
  slaEscalation,
];

function buildPortugueseTemplateDefs() {
  return TEMPLATE_GETTERS.map((getter) => {
    const template = getter();
    const translations = template.translations.filter((translation) => translation.language === 'pt');
    if (translations.length !== 1) {
      throw new Error(`Template '${template.templateName}' must define exactly one pt translation`);
    }
    return {
      ...template,
      translations,
    };
  });
}

function templateNames() {
  return buildPortugueseTemplateDefs().map((template) => template.templateName);
}

function buildPortugueseRows(subtypes, now = new Date()) {
  const subtypeIdsByName = new Map(subtypes.map((subtype) => [subtype.name, subtype.id]));

  return buildPortugueseTemplateDefs().map((template) => {
    const subtypeId = subtypeIdsByName.get(template.subtypeName);
    if (!subtypeId) {
      throw new Error(`Notification subtype '${template.subtypeName}' not found for template '${template.templateName}'`);
    }

    const translation = template.translations[0];
    return {
      name: template.templateName,
      language_code: 'pt',
      subject: translation.subject,
      html_content: translation.htmlContent,
      text_content: translation.textContent,
      notification_subtype_id: subtypeId,
      updated_at: now,
    };
  });
}

async function upsertPortugueseEmailRows(knex, rows) {
  if (rows.length === 0) return;
  await knex('system_email_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge(['subject', 'html_content', 'text_content', 'notification_subtype_id', 'updated_at']);
}

async function deletePortugueseEmailRows(knex) {
  await knex('system_email_templates')
    .where({ language_code: 'pt' })
    .whereIn('name', templateNames())
    .del();
}

exports.up = async function up(knex) {
  await upsertEmailCategoriesAndSubtypes(knex);
  const subtypes = await knex('notification_subtypes').select('id', 'name');
  const rows = buildPortugueseRows(subtypes);
  await upsertPortugueseEmailRows(knex, rows);
  console.log(`Added/updated ${rows.length} Brazilian Portuguese email templates.`);
};

exports.down = async function down(knex) {
  await deletePortugueseEmailRows(knex);
};

exports.TEMPLATE_GETTERS = TEMPLATE_GETTERS;
exports.buildPortugueseTemplateDefs = buildPortugueseTemplateDefs;
exports.buildPortugueseRows = buildPortugueseRows;
exports.templateNames = templateNames;
exports.upsertPortugueseEmailRows = upsertPortugueseEmailRows;
exports.deletePortugueseEmailRows = deletePortugueseEmailRows;
