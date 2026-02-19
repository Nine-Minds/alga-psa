/**
 * Source of truth: appointment-related internal notification templates.
 */
const TEMPLATES = [
  {
    templateName: 'appointment-request-created-client',
    subtypeName: 'appointment-request-created',
    translations: {
      en: { title: 'Appointment Request Submitted', message: 'Your appointment request for {{serviceName}} on {{requestedDate}} has been submitted and is pending approval.' },
      fr: { title: 'Demande de rendez-vous soumise', message: "Votre demande de rendez-vous pour {{serviceName}} le {{requestedDate}} a été soumise et est en attente d'approbation." },
      es: { title: 'Solicitud de cita enviada', message: 'Su solicitud de cita para {{serviceName}} el {{requestedDate}} ha sido enviada y está pendiente de aprobación.' },
      de: { title: 'Terminanfrage eingereicht', message: 'Ihre Terminanfrage für {{serviceName}} am {{requestedDate}} wurde eingereicht und wartet auf Genehmigung.' },
      nl: { title: 'Afspraakverzoek ingediend', message: 'Uw afspraakverzoek voor {{serviceName}} op {{requestedDate}} is ingediend en wacht op goedkeuring.' },
      it: { title: 'Richiesta di appuntamento inviata', message: 'La tua richiesta di appuntamento per {{serviceName}} il {{requestedDate}} è stata inviata ed è in attesa di approvazione.' },
      pl: { title: 'Wniosek o wizytę wysłany', message: 'Twój wniosek o wizytę na {{serviceName}} w dniu {{requestedDate}} został wysłany i oczekuje na zatwierdzenie.' },
    },
  },
  {
    templateName: 'appointment-request-created-staff',
    subtypeName: 'appointment-request-created',
    translations: {
      en: { title: 'New Appointment Request from {{clientName}}', message: '{{requesterName}} has requested an appointment for {{serviceName}} on {{requestedDate}} at {{requestedTime}}.' },
      fr: { title: 'Nouvelle demande de rendez-vous de {{clientName}}', message: '{{requesterName}} a demandé un rendez-vous pour {{serviceName}} le {{requestedDate}} à {{requestedTime}}.' },
      es: { title: 'Nueva solicitud de cita de {{clientName}}', message: '{{requesterName}} ha solicitado una cita para {{serviceName}} el {{requestedDate}} a las {{requestedTime}}.' },
      de: { title: 'Neue Terminanfrage von {{clientName}}', message: '{{requesterName}} hat einen Termin für {{serviceName}} am {{requestedDate}} um {{requestedTime}} angefragt.' },
      nl: { title: 'Nieuw afspraakverzoek van {{clientName}}', message: '{{requesterName}} heeft een afspraak aangevraagd voor {{serviceName}} op {{requestedDate}} om {{requestedTime}}.' },
      it: { title: 'Nuova richiesta di appuntamento da {{clientName}}', message: '{{requesterName}} ha richiesto un appuntamento per {{serviceName}} il {{requestedDate}} alle {{requestedTime}}.' },
      pl: { title: 'Nowy wniosek o wizytę od {{clientName}}', message: '{{requesterName}} poprosił(a) o wizytę na {{serviceName}} w dniu {{requestedDate}} o {{requestedTime}}.' },
    },
  },
  {
    templateName: 'appointment-request-approved',
    subtypeName: 'appointment-request-approved',
    translations: {
      en: { title: 'Appointment Confirmed!', message: 'Your appointment for {{serviceName}} on {{appointmentDate}} at {{appointmentTime}} has been confirmed. Assigned technician: {{technicianName}}.' },
      fr: { title: 'Rendez-vous confirmé !', message: 'Votre rendez-vous pour {{serviceName}} le {{appointmentDate}} à {{appointmentTime}} a été confirmé. Technicien assigné : {{technicianName}}.' },
      es: { title: '¡Cita confirmada!', message: 'Su cita para {{serviceName}} el {{appointmentDate}} a las {{appointmentTime}} ha sido confirmada. Técnico asignado: {{technicianName}}.' },
      de: { title: 'Termin bestätigt!', message: 'Ihr Termin für {{serviceName}} am {{appointmentDate}} um {{appointmentTime}} wurde bestätigt. Zugewiesener Techniker: {{technicianName}}.' },
      nl: { title: 'Afspraak bevestigd!', message: 'Uw afspraak voor {{serviceName}} op {{appointmentDate}} om {{appointmentTime}} is bevestigd. Toegewezen technicus: {{technicianName}}.' },
      it: { title: 'Appuntamento confermato!', message: 'Il tuo appuntamento per {{serviceName}} il {{appointmentDate}} alle {{appointmentTime}} è stato confermato. Tecnico assegnato: {{technicianName}}.' },
      pl: { title: 'Wizyta potwierdzona!', message: 'Twoja wizyta na {{serviceName}} w dniu {{appointmentDate}} o {{appointmentTime}} została potwierdzona. Przypisany technik: {{technicianName}}.' },
    },
  },
  {
    templateName: 'appointment-request-declined',
    subtypeName: 'appointment-request-declined',
    translations: {
      en: { title: 'Appointment Request Update', message: 'Your appointment request for {{serviceName}} could not be accommodated. {{declineReason}}' },
      fr: { title: 'Mise à jour de la demande de rendez-vous', message: "Votre demande de rendez-vous pour {{serviceName}} n'a pas pu être acceptée. {{declineReason}}" },
      es: { title: 'Actualización de solicitud de cita', message: 'No se pudo acomodar su solicitud de cita para {{serviceName}}. {{declineReason}}' },
      de: { title: 'Terminanfrage Aktualisierung', message: 'Ihre Terminanfrage für {{serviceName}} konnte nicht berücksichtigt werden. {{declineReason}}' },
      nl: { title: 'Update afspraakverzoek', message: 'Uw afspraakverzoek voor {{serviceName}} kon niet worden geaccepteerd. {{declineReason}}' },
      it: { title: 'Aggiornamento richiesta di appuntamento', message: 'La tua richiesta di appuntamento per {{serviceName}} non ha potuto essere accolta. {{declineReason}}' },
      pl: { title: 'Aktualizacja wniosku o wizytę', message: 'Nie udało się zrealizować wniosku o wizytę na {{serviceName}}. {{declineReason}}' },
    },
  },
  {
    templateName: 'appointment-request-cancelled-client',
    subtypeName: 'appointment-request-cancelled',
    translations: {
      en: { title: 'Appointment Request Cancelled', message: 'Your appointment request for {{serviceName}} on {{requestedDate}} has been cancelled successfully.' },
      fr: { title: 'Demande de rendez-vous annulée', message: 'Votre demande de rendez-vous pour {{serviceName}} le {{requestedDate}} a été annulée avec succès.' },
      es: { title: 'Solicitud de cita cancelada', message: 'Su solicitud de cita para {{serviceName}} el {{requestedDate}} ha sido cancelada exitosamente.' },
      de: { title: 'Terminanfrage storniert', message: 'Ihre Terminanfrage für {{serviceName}} am {{requestedDate}} wurde erfolgreich storniert.' },
      nl: { title: 'Afspraakverzoek geannuleerd', message: 'Uw afspraakverzoek voor {{serviceName}} op {{requestedDate}} is succesvol geannuleerd.' },
      it: { title: 'Richiesta di appuntamento cancellata', message: 'La tua richiesta di appuntamento per {{serviceName}} il {{requestedDate}} è stata cancellata con successo.' },
      pl: { title: 'Wniosek o wizytę anulowany', message: 'Twój wniosek o wizytę na {{serviceName}} w dniu {{requestedDate}} został pomyślnie anulowany.' },
    },
  },
  {
    templateName: 'appointment-request-cancelled-staff',
    subtypeName: 'appointment-request-cancelled',
    translations: {
      en: { title: 'Appointment Request Cancelled', message: '{{requesterName}} has cancelled their appointment request for {{serviceName}} on {{requestedDate}}.' },
      fr: { title: 'Demande de rendez-vous annulée', message: '{{requesterName}} a annulé sa demande de rendez-vous pour {{serviceName}} le {{requestedDate}}.' },
      es: { title: 'Solicitud de cita cancelada', message: '{{requesterName}} ha cancelado su solicitud de cita para {{serviceName}} el {{requestedDate}}.' },
      de: { title: 'Terminanfrage storniert', message: '{{requesterName}} hat die Terminanfrage für {{serviceName}} am {{requestedDate}} storniert.' },
      nl: { title: 'Afspraakverzoek geannuleerd', message: '{{requesterName}} heeft zijn/haar afspraakverzoek voor {{serviceName}} op {{requestedDate}} geannuleerd.' },
      it: { title: 'Richiesta di appuntamento cancellata', message: '{{requesterName}} ha cancellato la sua richiesta di appuntamento per {{serviceName}} il {{requestedDate}}.' },
      pl: { title: 'Wniosek o wizytę anulowany', message: '{{requesterName}} anulował(a) wniosek o wizytę na {{serviceName}} w dniu {{requestedDate}}.' },
    },
  },
  {
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
  },
];

module.exports = { TEMPLATES };
