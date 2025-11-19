/**
 * Migration: Add Appointments category to internal notifications
 *
 * Creates:
 * - Appointments notification category
 * - Subtypes for appointment events
 * - Notification templates in English (with placeholders for other languages)
 */

exports.up = async function(knex) {
  console.log('Adding appointments internal notification category...');

  // 1. Insert Appointments category
  const [appointmentsCategory] = await knex('internal_notification_categories')
    .insert([
      {
        name: 'appointments',
        description: 'Appointment request and scheduling notifications',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true  // Available for both MSP and client portal
      }
    ])
    .onConflict('name')
    .merge({
      description: knex.raw('excluded.description'),
      available_for_client_portal: knex.raw('excluded.available_for_client_portal')
    })
    .returning('*');

  const categoryId = appointmentsCategory.internal_notification_category_id;

  // 2. Insert subtypes
  const subtypes = await knex('internal_notification_subtypes')
    .insert([
      {
        internal_category_id: categoryId,
        name: 'appointment-request-created',
        description: 'New appointment request submitted',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      },
      {
        internal_category_id: categoryId,
        name: 'appointment-request-approved',
        description: 'Appointment request approved',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      },
      {
        internal_category_id: categoryId,
        name: 'appointment-request-declined',
        description: 'Appointment request declined',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      },
      {
        internal_category_id: categoryId,
        name: 'appointment-request-cancelled',
        description: 'Appointment request cancelled',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: true
      }
    ])
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('excluded.description'),
      available_for_client_portal: knex.raw('excluded.available_for_client_portal')
    })
    .returning('*');

  // Get subtype IDs
  const requestCreatedSubtype = subtypes.find(s => s.name === 'appointment-request-created');
  const requestApprovedSubtype = subtypes.find(s => s.name === 'appointment-request-approved');
  const requestDeclinedSubtype = subtypes.find(s => s.name === 'appointment-request-declined');
  const requestCancelledSubtype = subtypes.find(s => s.name === 'appointment-request-cancelled');

  // 3. Insert templates for all supported languages
  await knex('internal_notification_templates')
    .insert([
      // English (en)
      {
        name: 'appointment-request-created-client',
        language_code: 'en',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Appointment Request Submitted',
        message: 'Your appointment request for {{serviceName}} on {{requestedDate}} has been submitted and is pending approval.'
      },
      {
        name: 'appointment-request-created-staff',
        language_code: 'en',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'New Appointment Request from {{clientName}}',
        message: '{{requesterName}} has requested an appointment for {{serviceName}} on {{requestedDate}} at {{requestedTime}}.'
      },
      {
        name: 'appointment-request-approved',
        language_code: 'en',
        subtype_id: requestApprovedSubtype.internal_notification_subtype_id,
        title: 'Appointment Confirmed!',
        message: 'Your appointment for {{serviceName}} on {{appointmentDate}} at {{appointmentTime}} has been confirmed. Assigned technician: {{technicianName}}.'
      },
      {
        name: 'appointment-request-declined',
        language_code: 'en',
        subtype_id: requestDeclinedSubtype.internal_notification_subtype_id,
        title: 'Appointment Request Update',
        message: 'Your appointment request for {{serviceName}} could not be accommodated. {{declineReason}}'
      },
      {
        name: 'appointment-request-cancelled-client',
        language_code: 'en',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Appointment Request Cancelled',
        message: 'Your appointment request for {{serviceName}} on {{requestedDate}} has been cancelled successfully.'
      },
      {
        name: 'appointment-request-cancelled-staff',
        language_code: 'en',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Appointment Request Cancelled',
        message: '{{requesterName}} has cancelled their appointment request for {{serviceName}} on {{requestedDate}}.'
      },

      // German (de)
      {
        name: 'appointment-request-created-client',
        language_code: 'de',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Terminanfrage eingereicht',
        message: 'Ihre Terminanfrage für {{serviceName}} am {{requestedDate}} wurde eingereicht und wartet auf Genehmigung.'
      },
      {
        name: 'appointment-request-created-staff',
        language_code: 'de',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Neue Terminanfrage von {{clientName}}',
        message: '{{requesterName}} hat einen Termin für {{serviceName}} am {{requestedDate}} um {{requestedTime}} angefragt.'
      },
      {
        name: 'appointment-request-approved',
        language_code: 'de',
        subtype_id: requestApprovedSubtype.internal_notification_subtype_id,
        title: 'Termin bestätigt!',
        message: 'Ihr Termin für {{serviceName}} am {{appointmentDate}} um {{appointmentTime}} wurde bestätigt. Zugewiesener Techniker: {{technicianName}}.'
      },
      {
        name: 'appointment-request-declined',
        language_code: 'de',
        subtype_id: requestDeclinedSubtype.internal_notification_subtype_id,
        title: 'Terminanfrage Aktualisierung',
        message: 'Ihre Terminanfrage für {{serviceName}} konnte nicht berücksichtigt werden. {{declineReason}}'
      },
      {
        name: 'appointment-request-cancelled-client',
        language_code: 'de',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Terminanfrage storniert',
        message: 'Ihre Terminanfrage für {{serviceName}} am {{requestedDate}} wurde erfolgreich storniert.'
      },
      {
        name: 'appointment-request-cancelled-staff',
        language_code: 'de',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Terminanfrage storniert',
        message: '{{requesterName}} hat die Terminanfrage für {{serviceName}} am {{requestedDate}} storniert.'
      },

      // Spanish (es)
      {
        name: 'appointment-request-created-client',
        language_code: 'es',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Solicitud de cita enviada',
        message: 'Su solicitud de cita para {{serviceName}} el {{requestedDate}} ha sido enviada y está pendiente de aprobación.'
      },
      {
        name: 'appointment-request-created-staff',
        language_code: 'es',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Nueva solicitud de cita de {{clientName}}',
        message: '{{requesterName}} ha solicitado una cita para {{serviceName}} el {{requestedDate}} a las {{requestedTime}}.'
      },
      {
        name: 'appointment-request-approved',
        language_code: 'es',
        subtype_id: requestApprovedSubtype.internal_notification_subtype_id,
        title: '¡Cita confirmada!',
        message: 'Su cita para {{serviceName}} el {{appointmentDate}} a las {{appointmentTime}} ha sido confirmada. Técnico asignado: {{technicianName}}.'
      },
      {
        name: 'appointment-request-declined',
        language_code: 'es',
        subtype_id: requestDeclinedSubtype.internal_notification_subtype_id,
        title: 'Actualización de solicitud de cita',
        message: 'No se pudo acomodar su solicitud de cita para {{serviceName}}. {{declineReason}}'
      },
      {
        name: 'appointment-request-cancelled-client',
        language_code: 'es',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Solicitud de cita cancelada',
        message: 'Su solicitud de cita para {{serviceName}} el {{requestedDate}} ha sido cancelada exitosamente.'
      },
      {
        name: 'appointment-request-cancelled-staff',
        language_code: 'es',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Solicitud de cita cancelada',
        message: '{{requesterName}} ha cancelado su solicitud de cita para {{serviceName}} el {{requestedDate}}.'
      },

      // French (fr)
      {
        name: 'appointment-request-created-client',
        language_code: 'fr',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Demande de rendez-vous soumise',
        message: 'Votre demande de rendez-vous pour {{serviceName}} le {{requestedDate}} a été soumise et est en attente d\'approbation.'
      },
      {
        name: 'appointment-request-created-staff',
        language_code: 'fr',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Nouvelle demande de rendez-vous de {{clientName}}',
        message: '{{requesterName}} a demandé un rendez-vous pour {{serviceName}} le {{requestedDate}} à {{requestedTime}}.'
      },
      {
        name: 'appointment-request-approved',
        language_code: 'fr',
        subtype_id: requestApprovedSubtype.internal_notification_subtype_id,
        title: 'Rendez-vous confirmé !',
        message: 'Votre rendez-vous pour {{serviceName}} le {{appointmentDate}} à {{appointmentTime}} a été confirmé. Technicien assigné : {{technicianName}}.'
      },
      {
        name: 'appointment-request-declined',
        language_code: 'fr',
        subtype_id: requestDeclinedSubtype.internal_notification_subtype_id,
        title: 'Mise à jour de la demande de rendez-vous',
        message: 'Votre demande de rendez-vous pour {{serviceName}} n\'a pas pu être acceptée. {{declineReason}}'
      },
      {
        name: 'appointment-request-cancelled-client',
        language_code: 'fr',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Demande de rendez-vous annulée',
        message: 'Votre demande de rendez-vous pour {{serviceName}} le {{requestedDate}} a été annulée avec succès.'
      },
      {
        name: 'appointment-request-cancelled-staff',
        language_code: 'fr',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Demande de rendez-vous annulée',
        message: '{{requesterName}} a annulé sa demande de rendez-vous pour {{serviceName}} le {{requestedDate}}.'
      },

      // Italian (it)
      {
        name: 'appointment-request-created-client',
        language_code: 'it',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Richiesta di appuntamento inviata',
        message: 'La tua richiesta di appuntamento per {{serviceName}} il {{requestedDate}} è stata inviata ed è in attesa di approvazione.'
      },
      {
        name: 'appointment-request-created-staff',
        language_code: 'it',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Nuova richiesta di appuntamento da {{clientName}}',
        message: '{{requesterName}} ha richiesto un appuntamento per {{serviceName}} il {{requestedDate}} alle {{requestedTime}}.'
      },
      {
        name: 'appointment-request-approved',
        language_code: 'it',
        subtype_id: requestApprovedSubtype.internal_notification_subtype_id,
        title: 'Appuntamento confermato!',
        message: 'Il tuo appuntamento per {{serviceName}} il {{appointmentDate}} alle {{appointmentTime}} è stato confermato. Tecnico assegnato: {{technicianName}}.'
      },
      {
        name: 'appointment-request-declined',
        language_code: 'it',
        subtype_id: requestDeclinedSubtype.internal_notification_subtype_id,
        title: 'Aggiornamento richiesta di appuntamento',
        message: 'La tua richiesta di appuntamento per {{serviceName}} non ha potuto essere accolta. {{declineReason}}'
      },
      {
        name: 'appointment-request-cancelled-client',
        language_code: 'it',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Richiesta di appuntamento cancellata',
        message: 'La tua richiesta di appuntamento per {{serviceName}} il {{requestedDate}} è stata cancellata con successo.'
      },
      {
        name: 'appointment-request-cancelled-staff',
        language_code: 'it',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Richiesta di appuntamento cancellata',
        message: '{{requesterName}} ha cancellato la sua richiesta di appuntamento per {{serviceName}} il {{requestedDate}}.'
      },

      // Dutch (nl)
      {
        name: 'appointment-request-created-client',
        language_code: 'nl',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Afspraakverzoek ingediend',
        message: 'Uw afspraakverzoek voor {{serviceName}} op {{requestedDate}} is ingediend en wacht op goedkeuring.'
      },
      {
        name: 'appointment-request-created-staff',
        language_code: 'nl',
        subtype_id: requestCreatedSubtype.internal_notification_subtype_id,
        title: 'Nieuw afspraakverzoek van {{clientName}}',
        message: '{{requesterName}} heeft een afspraak aangevraagd voor {{serviceName}} op {{requestedDate}} om {{requestedTime}}.'
      },
      {
        name: 'appointment-request-approved',
        language_code: 'nl',
        subtype_id: requestApprovedSubtype.internal_notification_subtype_id,
        title: 'Afspraak bevestigd!',
        message: 'Uw afspraak voor {{serviceName}} op {{appointmentDate}} om {{appointmentTime}} is bevestigd. Toegewezen technicus: {{technicianName}}.'
      },
      {
        name: 'appointment-request-declined',
        language_code: 'nl',
        subtype_id: requestDeclinedSubtype.internal_notification_subtype_id,
        title: 'Update afspraakverzoek',
        message: 'Uw afspraakverzoek voor {{serviceName}} kon niet worden geaccepteerd. {{declineReason}}'
      },
      {
        name: 'appointment-request-cancelled-client',
        language_code: 'nl',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Afspraakverzoek geannuleerd',
        message: 'Uw afspraakverzoek voor {{serviceName}} op {{requestedDate}} is succesvol geannuleerd.'
      },
      {
        name: 'appointment-request-cancelled-staff',
        language_code: 'nl',
        subtype_id: requestCancelledSubtype.internal_notification_subtype_id,
        title: 'Afspraakverzoek geannuleerd',
        message: '{{requesterName}} heeft zijn/haar afspraakverzoek voor {{serviceName}} op {{requestedDate}} geannuleerd.'
      }
    ])
    .onConflict(['name', 'language_code'])
    .ignore();

  console.log('Appointments internal notification category created successfully');
};

exports.down = async function(knex) {
  console.log('Removing appointments internal notification category...');

  // Get the category ID
  const category = await knex('internal_notification_categories')
    .where({ name: 'appointments' })
    .first();

  if (!category) {
    console.log('Appointments category not found, nothing to remove');
    return;
  }

  const categoryId = category.internal_notification_category_id;

  // Get subtypes
  const subtypes = await knex('internal_notification_subtypes')
    .where({ internal_category_id: categoryId })
    .select('internal_notification_subtype_id');

  const subtypeIds = subtypes.map(s => s.internal_notification_subtype_id);

  if (subtypeIds.length > 0) {
    // Delete templates associated with these subtypes
    await knex('internal_notification_templates')
      .whereIn('subtype_id', subtypeIds)
      .delete();

    // Delete subtypes
    await knex('internal_notification_subtypes')
      .whereIn('internal_notification_subtype_id', subtypeIds)
      .delete();
  }

  // Delete category
  await knex('internal_notification_categories')
    .where({ internal_notification_category_id: categoryId })
    .delete();

  console.log('Appointments internal notification category removed successfully');
};
