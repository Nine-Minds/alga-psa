/**
 * Add appointment-assigned-technician email + internal notification templates.
 *
 * Email: sent to the assigned technician when an appointment request is approved,
 * including an ICS calendar attachment.
 * Internal: in-app notification for the assigned technician.
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { getTemplate: apptAssignedTech } = require('./utils/templates/email/appointments/appointmentAssignedTechnician.cjs');

// Only the new internal template
const INTERNAL_TEMPLATE = {
  templateName: 'appointment-assigned-technician',
  subtypeName: 'appointment-assigned-technician',
  translations: {
    en: { title: 'New Appointment Assigned', message: 'You have been assigned an appointment for {{serviceName}} on {{appointmentDate}} at {{appointmentTime}}. Client: {{clientName}}.' },
    fr: { title: 'Nouveau rendez-vous assigné', message: 'Un rendez-vous pour {{serviceName}} le {{appointmentDate}} à {{appointmentTime}} vous a été assigné. Client : {{clientName}}.' },
    es: { title: 'Nueva cita asignada', message: 'Se le ha asignado una cita para {{serviceName}} el {{appointmentDate}} a las {{appointmentTime}}. Cliente: {{clientName}}.' },
    de: { title: 'Neuer Termin zugewiesen', message: 'Ihnen wurde ein Termin für {{serviceName}} am {{appointmentDate}} um {{appointmentTime}} zugewiesen. Kunde: {{clientName}}.' },
    nl: { title: 'Nieuwe afspraak toegewezen', message: 'Er is een afspraak voor {{serviceName}} op {{appointmentDate}} om {{appointmentTime}} aan u toegewezen. Klant: {{clientName}}.' },
    it: { title: 'Nuovo appuntamento assegnato', message: 'Ti è stato assegnato un appuntamento per {{serviceName}} il {{appointmentDate}} alle {{appointmentTime}}. Cliente: {{clientName}}.' },
    pl: { title: 'Nowa wizyta przypisana', message: 'Przypisano Ci wizytę na {{serviceName}} w dniu {{appointmentDate}} o {{appointmentTime}}. Klient: {{clientName}}.' },
  },
};

exports.up = async function (knex) {
  // 1. Email template: categories, subtypes, and template
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertEmailTemplate(knex, apptAssignedTech());
  console.log('  ✓ appointment-assigned-technician email template added');

  // 2. Internal notification: categories, subtypes, and template
  await upsertCategoriesAndSubtypes(knex);
  await upsertInternalTemplates(knex, [INTERNAL_TEMPLATE]);
  console.log('  ✓ appointment-assigned-technician internal notification template added');
};

exports.down = async function (knex) {
  await knex('system_email_templates')
    .where({ name: 'appointment-assigned-technician' })
    .del();

  await knex('internal_notification_templates')
    .where({ name: 'appointment-assigned-technician' })
    .del();
};
