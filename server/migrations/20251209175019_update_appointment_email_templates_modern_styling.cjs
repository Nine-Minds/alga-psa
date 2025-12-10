/**
 * Migration: Update appointment email templates with modern styling
 *
 * Updates all appointment-related email templates across all languages to use
 * the same modern visual design as ticket notification templates (gradient header,
 * proper table layout, styled footer).
 *
 * Languages: en, de, es, fr, it, nl
 * Templates: appointment-request-received, appointment-request-approved,
 *            appointment-request-declined, new-appointment-request
 */

// Template translations for each language
const translations = {
  en: {
    requestReceived: {
      subject: 'Appointment Request Received - {{serviceName}}',
      header: 'Appointment Request Received',
      greeting: 'Hello{{#if requesterName}} {{requesterName}}{{/if}}, thank you for submitting your appointment request. We have received your request and our team will review it shortly.',
      refLabel: 'Ref',
      serviceLabel: 'Service',
      requestedDateLabel: 'Requested Date',
      requestedTimeLabel: 'Requested Time',
      durationLabel: 'Duration',
      durationUnit: 'minutes',
      whatNextTitle: 'What happens next?',
      whatNextText: 'Our team will review your request and confirm availability. You will receive an email notification once your appointment has been approved or if any changes are needed. We typically respond within {{responseTime}}.',
      contactText: 'If you have any questions, please contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.',
      viewPortalButton: 'View in Portal'
    },
    requestApproved: {
      subject: 'Appointment Confirmed - {{serviceName}} on {{appointmentDate}}',
      header: 'Appointment Confirmed',
      greeting: 'Hello{{#if requesterName}} {{requesterName}}{{/if}}, great news! Your appointment request has been approved.',
      confirmedBadge: 'Confirmed',
      serviceLabel: 'Service',
      dateLabel: 'Date',
      timeLabel: 'Time',
      durationLabel: 'Duration',
      durationUnit: 'minutes',
      technicianLabel: 'Technician',
      importantTitle: 'Important Information',
      importantText: 'Please arrive a few minutes early. If you need to reschedule or cancel, please give us at least {{minimumNoticeHours}} hours notice.',
      addCalendarButton: 'Add to Calendar',
      contactText: 'Questions? Contact us at {{contactEmail}}{{#if contactPhone}} or {{contactPhone}}{{/if}}.'
    },
    requestDeclined: {
      subject: 'Appointment Request Update - {{serviceName}}',
      header: 'Appointment Request Update',
      greeting: 'Hello{{#if requesterName}} {{requesterName}}{{/if}}, unfortunately we were unable to accommodate your appointment request at the requested time.',
      declinedBadge: 'Unable to Schedule',
      serviceLabel: 'Service',
      requestedDateLabel: 'Requested Date',
      requestedTimeLabel: 'Requested Time',
      reasonTitle: 'Reason',
      apologyText: 'We apologize for any inconvenience. Please feel free to submit a new request for a different time.',
      newRequestButton: 'Request New Appointment',
      contactText: 'Questions? Contact us at {{contactEmail}}{{#if contactPhone}} or {{contactPhone}}{{/if}}.'
    },
    newRequest: {
      subject: 'New Appointment Request - {{serviceName}} from {{requesterName}}',
      header: 'New Appointment Request',
      greeting: 'A new appointment request has been submitted{{#if clientName}} for <strong>{{clientName}}</strong>{{/if}}. Please review and take appropriate action.',
      greetingText: 'A new appointment request has been submitted{{#if clientName}} for {{clientName}}{{/if}}. Please review and take appropriate action.',
      pendingBadge: 'Pending Review',
      requesterLabel: 'Requester',
      companyLabel: 'Company',
      serviceLabel: 'Service',
      requestedDateLabel: 'Requested Date',
      requestedTimeLabel: 'Requested Time',
      durationLabel: 'Duration',
      durationUnit: 'minutes',
      preferredTechLabel: 'Preferred Technician',
      notesTitle: 'Additional Notes',
      actionText: 'Please review this request and take appropriate action. The requester is waiting for confirmation.',
      reviewButton: 'Review & Approve'
    },
    footer: 'Powered by Alga PSA'
  },
  de: {
    requestReceived: {
      subject: 'Terminanfrage eingegangen - {{serviceName}}',
      header: 'Terminanfrage eingegangen',
      greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}}, vielen Dank für Ihre Terminanfrage. Wir haben Ihre Anfrage erhalten und unser Team wird sie in Kürze prüfen.',
      refLabel: 'Ref',
      serviceLabel: 'Service',
      requestedDateLabel: 'Gewünschtes Datum',
      requestedTimeLabel: 'Gewünschte Uhrzeit',
      durationLabel: 'Dauer',
      durationUnit: 'Minuten',
      whatNextTitle: 'Was passiert als Nächstes?',
      whatNextText: 'Unser Team wird Ihre Anfrage prüfen und die Verfügbarkeit bestätigen. Sie erhalten eine E-Mail-Benachrichtigung, sobald Ihr Termin genehmigt wurde oder falls Änderungen erforderlich sind. Wir antworten normalerweise innerhalb von {{responseTime}}.',
      contactText: 'Bei Fragen kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.',
      viewPortalButton: 'Im Portal anzeigen'
    },
    requestApproved: {
      subject: 'Termin bestätigt - {{serviceName}} am {{appointmentDate}}',
      header: 'Termin bestätigt',
      greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}}, gute Nachrichten! Ihre Terminanfrage wurde genehmigt.',
      confirmedBadge: 'Bestätigt',
      serviceLabel: 'Service',
      dateLabel: 'Datum',
      timeLabel: 'Uhrzeit',
      durationLabel: 'Dauer',
      durationUnit: 'Minuten',
      technicianLabel: 'Techniker',
      importantTitle: 'Wichtige Informationen',
      importantText: 'Bitte erscheinen Sie einige Minuten früher. Wenn Sie umbuchen oder stornieren müssen, geben Sie uns bitte mindestens {{minimumNoticeHours}} Stunden Vorlaufzeit.',
      addCalendarButton: 'Zum Kalender hinzufügen',
      contactText: 'Fragen? Kontaktieren Sie uns unter {{contactEmail}}{{#if contactPhone}} oder {{contactPhone}}{{/if}}.'
    },
    requestDeclined: {
      subject: 'Update zur Terminanfrage - {{serviceName}}',
      header: 'Update zur Terminanfrage',
      greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}}, leider konnten wir Ihre Terminanfrage zum gewünschten Zeitpunkt nicht berücksichtigen.',
      declinedBadge: 'Nicht möglich',
      serviceLabel: 'Service',
      requestedDateLabel: 'Gewünschtes Datum',
      requestedTimeLabel: 'Gewünschte Uhrzeit',
      reasonTitle: 'Grund',
      apologyText: 'Wir entschuldigen uns für etwaige Unannehmlichkeiten. Sie können gerne eine neue Anfrage für einen anderen Zeitpunkt einreichen.',
      newRequestButton: 'Neuen Termin anfragen',
      contactText: 'Fragen? Kontaktieren Sie uns unter {{contactEmail}}{{#if contactPhone}} oder {{contactPhone}}{{/if}}.'
    },
    newRequest: {
      subject: 'Neue Terminanfrage - {{serviceName}} von {{requesterName}}',
      header: 'Neue Terminanfrage',
      greeting: 'Eine neue Terminanfrage wurde eingereicht{{#if clientName}} für <strong>{{clientName}}</strong>{{/if}}. Bitte prüfen und entsprechend handeln.',
      greetingText: 'Eine neue Terminanfrage wurde eingereicht{{#if clientName}} für {{clientName}}{{/if}}. Bitte prüfen und entsprechend handeln.',
      pendingBadge: 'Prüfung ausstehend',
      requesterLabel: 'Anfragender',
      companyLabel: 'Unternehmen',
      serviceLabel: 'Service',
      requestedDateLabel: 'Gewünschtes Datum',
      requestedTimeLabel: 'Gewünschte Uhrzeit',
      durationLabel: 'Dauer',
      durationUnit: 'Minuten',
      preferredTechLabel: 'Bevorzugter Techniker',
      notesTitle: 'Zusätzliche Anmerkungen',
      actionText: 'Bitte prüfen Sie diese Anfrage und handeln Sie entsprechend. Der Anfragende wartet auf eine Bestätigung.',
      reviewButton: 'Prüfen & Genehmigen'
    },
    footer: 'Powered by Alga PSA'
  },
  es: {
    requestReceived: {
      subject: 'Solicitud de cita recibida - {{serviceName}}',
      header: 'Solicitud de cita recibida',
      greeting: 'Hola{{#if requesterName}} {{requesterName}}{{/if}}, gracias por enviar su solicitud de cita. Hemos recibido su solicitud y nuestro equipo la revisará en breve.',
      refLabel: 'Ref',
      serviceLabel: 'Servicio',
      requestedDateLabel: 'Fecha solicitada',
      requestedTimeLabel: 'Hora solicitada',
      durationLabel: 'Duración',
      durationUnit: 'minutos',
      whatNextTitle: '¿Qué sigue?',
      whatNextText: 'Nuestro equipo revisará su solicitud y confirmará la disponibilidad. Recibirá una notificación por correo electrónico una vez que su cita haya sido aprobada o si se necesitan cambios. Normalmente respondemos dentro de {{responseTime}}.',
      contactText: 'Si tiene alguna pregunta, contáctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.',
      viewPortalButton: 'Ver en el Portal'
    },
    requestApproved: {
      subject: 'Cita confirmada - {{serviceName}} el {{appointmentDate}}',
      header: 'Cita confirmada',
      greeting: 'Hola{{#if requesterName}} {{requesterName}}{{/if}}, ¡buenas noticias! Su solicitud de cita ha sido aprobada.',
      confirmedBadge: 'Confirmada',
      serviceLabel: 'Servicio',
      dateLabel: 'Fecha',
      timeLabel: 'Hora',
      durationLabel: 'Duración',
      durationUnit: 'minutos',
      technicianLabel: 'Técnico',
      importantTitle: 'Información importante',
      importantText: 'Por favor llegue unos minutos antes. Si necesita reprogramar o cancelar, avísenos con al menos {{minimumNoticeHours}} horas de anticipación.',
      addCalendarButton: 'Agregar al calendario',
      contactText: '¿Preguntas? Contáctenos en {{contactEmail}}{{#if contactPhone}} o {{contactPhone}}{{/if}}.'
    },
    requestDeclined: {
      subject: 'Actualización de solicitud de cita - {{serviceName}}',
      header: 'Actualización de solicitud de cita',
      greeting: 'Hola{{#if requesterName}} {{requesterName}}{{/if}}, lamentablemente no pudimos acomodar su solicitud de cita en el horario solicitado.',
      declinedBadge: 'No disponible',
      serviceLabel: 'Servicio',
      requestedDateLabel: 'Fecha solicitada',
      requestedTimeLabel: 'Hora solicitada',
      reasonTitle: 'Motivo',
      apologyText: 'Nos disculpamos por cualquier inconveniente. No dude en enviar una nueva solicitud para un horario diferente.',
      newRequestButton: 'Solicitar nueva cita',
      contactText: '¿Preguntas? Contáctenos en {{contactEmail}}{{#if contactPhone}} o {{contactPhone}}{{/if}}.'
    },
    newRequest: {
      subject: 'Nueva solicitud de cita - {{serviceName}} de {{requesterName}}',
      header: 'Nueva solicitud de cita',
      greeting: 'Se ha enviado una nueva solicitud de cita{{#if clientName}} para <strong>{{clientName}}</strong>{{/if}}. Por favor revise y tome las medidas apropiadas.',
      greetingText: 'Se ha enviado una nueva solicitud de cita{{#if clientName}} para {{clientName}}{{/if}}. Por favor revise y tome las medidas apropiadas.',
      pendingBadge: 'Revisión pendiente',
      requesterLabel: 'Solicitante',
      companyLabel: 'Empresa',
      serviceLabel: 'Servicio',
      requestedDateLabel: 'Fecha solicitada',
      requestedTimeLabel: 'Hora solicitada',
      durationLabel: 'Duración',
      durationUnit: 'minutos',
      preferredTechLabel: 'Técnico preferido',
      notesTitle: 'Notas adicionales',
      actionText: 'Por favor revise esta solicitud y tome las medidas apropiadas. El solicitante está esperando confirmación.',
      reviewButton: 'Revisar y aprobar'
    },
    footer: 'Powered by Alga PSA'
  },
  fr: {
    requestReceived: {
      subject: 'Demande de rendez-vous reçue - {{serviceName}}',
      header: 'Demande de rendez-vous reçue',
      greeting: 'Bonjour{{#if requesterName}} {{requesterName}}{{/if}}, merci d\'avoir soumis votre demande de rendez-vous. Nous avons reçu votre demande et notre équipe l\'examinera sous peu.',
      refLabel: 'Réf',
      serviceLabel: 'Service',
      requestedDateLabel: 'Date demandée',
      requestedTimeLabel: 'Heure demandée',
      durationLabel: 'Durée',
      durationUnit: 'minutes',
      whatNextTitle: 'Quelle est la suite ?',
      whatNextText: 'Notre équipe examinera votre demande et confirmera la disponibilité. Vous recevrez une notification par e-mail une fois votre rendez-vous approuvé ou si des modifications sont nécessaires. Nous répondons généralement dans les {{responseTime}}.',
      contactText: 'Si vous avez des questions, contactez-nous à {{contactEmail}}{{#if contactPhone}} ou appelez le {{contactPhone}}{{/if}}.',
      viewPortalButton: 'Voir dans le portail'
    },
    requestApproved: {
      subject: 'Rendez-vous confirmé - {{serviceName}} le {{appointmentDate}}',
      header: 'Rendez-vous confirmé',
      greeting: 'Bonjour{{#if requesterName}} {{requesterName}}{{/if}}, bonne nouvelle ! Votre demande de rendez-vous a été approuvée.',
      confirmedBadge: 'Confirmé',
      serviceLabel: 'Service',
      dateLabel: 'Date',
      timeLabel: 'Heure',
      durationLabel: 'Durée',
      durationUnit: 'minutes',
      technicianLabel: 'Technicien',
      importantTitle: 'Informations importantes',
      importantText: 'Veuillez arriver quelques minutes en avance. Si vous devez reporter ou annuler, veuillez nous prévenir au moins {{minimumNoticeHours}} heures à l\'avance.',
      addCalendarButton: 'Ajouter au calendrier',
      contactText: 'Questions ? Contactez-nous à {{contactEmail}}{{#if contactPhone}} ou {{contactPhone}}{{/if}}.'
    },
    requestDeclined: {
      subject: 'Mise à jour de la demande de rendez-vous - {{serviceName}}',
      header: 'Mise à jour de la demande de rendez-vous',
      greeting: 'Bonjour{{#if requesterName}} {{requesterName}}{{/if}}, malheureusement nous n\'avons pas pu accommoder votre demande de rendez-vous à l\'heure demandée.',
      declinedBadge: 'Non disponible',
      serviceLabel: 'Service',
      requestedDateLabel: 'Date demandée',
      requestedTimeLabel: 'Heure demandée',
      reasonTitle: 'Raison',
      apologyText: 'Nous nous excusons pour tout inconvénient. N\'hésitez pas à soumettre une nouvelle demande pour un autre créneau.',
      newRequestButton: 'Demander un nouveau rendez-vous',
      contactText: 'Questions ? Contactez-nous à {{contactEmail}}{{#if contactPhone}} ou {{contactPhone}}{{/if}}.'
    },
    newRequest: {
      subject: 'Nouvelle demande de rendez-vous - {{serviceName}} de {{requesterName}}',
      header: 'Nouvelle demande de rendez-vous',
      greeting: 'Une nouvelle demande de rendez-vous a été soumise{{#if clientName}} pour <strong>{{clientName}}</strong>{{/if}}. Veuillez examiner et prendre les mesures appropriées.',
      greetingText: 'Une nouvelle demande de rendez-vous a été soumise{{#if clientName}} pour {{clientName}}{{/if}}. Veuillez examiner et prendre les mesures appropriées.',
      pendingBadge: 'En attente de révision',
      requesterLabel: 'Demandeur',
      companyLabel: 'Entreprise',
      serviceLabel: 'Service',
      requestedDateLabel: 'Date demandée',
      requestedTimeLabel: 'Heure demandée',
      durationLabel: 'Durée',
      durationUnit: 'minutes',
      preferredTechLabel: 'Technicien préféré',
      notesTitle: 'Notes supplémentaires',
      actionText: 'Veuillez examiner cette demande et prendre les mesures appropriées. Le demandeur attend une confirmation.',
      reviewButton: 'Examiner et approuver'
    },
    footer: 'Powered by Alga PSA'
  },
  it: {
    requestReceived: {
      subject: 'Richiesta appuntamento ricevuta - {{serviceName}}',
      header: 'Richiesta appuntamento ricevuta',
      greeting: 'Ciao{{#if requesterName}} {{requesterName}}{{/if}}, grazie per aver inviato la richiesta di appuntamento. Abbiamo ricevuto la tua richiesta e il nostro team la esaminerà a breve.',
      refLabel: 'Rif',
      serviceLabel: 'Servizio',
      requestedDateLabel: 'Data richiesta',
      requestedTimeLabel: 'Ora richiesta',
      durationLabel: 'Durata',
      durationUnit: 'minuti',
      whatNextTitle: 'Cosa succede dopo?',
      whatNextText: 'Il nostro team esaminerà la tua richiesta e confermerà la disponibilità. Riceverai una notifica via email una volta che il tuo appuntamento sarà approvato o se saranno necessarie modifiche. Di solito rispondiamo entro {{responseTime}}.',
      contactText: 'Per qualsiasi domanda, contattaci all\'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.',
      viewPortalButton: 'Visualizza nel portale'
    },
    requestApproved: {
      subject: 'Appuntamento confermato - {{serviceName}} il {{appointmentDate}}',
      header: 'Appuntamento confermato',
      greeting: 'Ciao{{#if requesterName}} {{requesterName}}{{/if}}, ottime notizie! La tua richiesta di appuntamento è stata approvata.',
      confirmedBadge: 'Confermato',
      serviceLabel: 'Servizio',
      dateLabel: 'Data',
      timeLabel: 'Ora',
      durationLabel: 'Durata',
      durationUnit: 'minuti',
      technicianLabel: 'Tecnico',
      importantTitle: 'Informazioni importanti',
      importantText: 'Per favore arriva qualche minuto prima. Se hai bisogno di riprogrammare o cancellare, avvisaci con almeno {{minimumNoticeHours}} ore di anticipo.',
      addCalendarButton: 'Aggiungi al calendario',
      contactText: 'Domande? Contattaci a {{contactEmail}}{{#if contactPhone}} o {{contactPhone}}{{/if}}.'
    },
    requestDeclined: {
      subject: 'Aggiornamento richiesta appuntamento - {{serviceName}}',
      header: 'Aggiornamento richiesta appuntamento',
      greeting: 'Ciao{{#if requesterName}} {{requesterName}}{{/if}}, purtroppo non siamo riusciti ad accogliere la tua richiesta di appuntamento all\'orario richiesto.',
      declinedBadge: 'Non disponibile',
      serviceLabel: 'Servizio',
      requestedDateLabel: 'Data richiesta',
      requestedTimeLabel: 'Ora richiesta',
      reasonTitle: 'Motivo',
      apologyText: 'Ci scusiamo per l\'inconveniente. Sentiti libero di inviare una nuova richiesta per un orario diverso.',
      newRequestButton: 'Richiedi nuovo appuntamento',
      contactText: 'Domande? Contattaci a {{contactEmail}}{{#if contactPhone}} o {{contactPhone}}{{/if}}.'
    },
    newRequest: {
      subject: 'Nuova richiesta appuntamento - {{serviceName}} da {{requesterName}}',
      header: 'Nuova richiesta appuntamento',
      greeting: 'È stata inviata una nuova richiesta di appuntamento{{#if clientName}} per <strong>{{clientName}}</strong>{{/if}}. Per favore esamina e agisci di conseguenza.',
      greetingText: 'È stata inviata una nuova richiesta di appuntamento{{#if clientName}} per {{clientName}}{{/if}}. Per favore esamina e agisci di conseguenza.',
      pendingBadge: 'In attesa di revisione',
      requesterLabel: 'Richiedente',
      companyLabel: 'Azienda',
      serviceLabel: 'Servizio',
      requestedDateLabel: 'Data richiesta',
      requestedTimeLabel: 'Ora richiesta',
      durationLabel: 'Durata',
      durationUnit: 'minuti',
      preferredTechLabel: 'Tecnico preferito',
      notesTitle: 'Note aggiuntive',
      actionText: 'Per favore esamina questa richiesta e agisci di conseguenza. Il richiedente è in attesa di conferma.',
      reviewButton: 'Esamina e approva'
    },
    footer: 'Powered by Alga PSA'
  },
  nl: {
    requestReceived: {
      subject: 'Afspraakverzoek ontvangen - {{serviceName}}',
      header: 'Afspraakverzoek ontvangen',
      greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}}, bedankt voor het indienen van uw afspraakverzoek. We hebben uw verzoek ontvangen en ons team zal het spoedig bekijken.',
      refLabel: 'Ref',
      serviceLabel: 'Service',
      requestedDateLabel: 'Gewenste datum',
      requestedTimeLabel: 'Gewenste tijd',
      durationLabel: 'Duur',
      durationUnit: 'minuten',
      whatNextTitle: 'Wat gebeurt er nu?',
      whatNextText: 'Ons team zal uw verzoek bekijken en de beschikbaarheid bevestigen. U ontvangt een e-mailmelding zodra uw afspraak is goedgekeurd of als er wijzigingen nodig zijn. We reageren doorgaans binnen {{responseTime}}.',
      contactText: 'Heeft u vragen? Neem contact met ons op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.',
      viewPortalButton: 'Bekijken in portal'
    },
    requestApproved: {
      subject: 'Afspraak bevestigd - {{serviceName}} op {{appointmentDate}}',
      header: 'Afspraak bevestigd',
      greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}}, goed nieuws! Uw afspraakverzoek is goedgekeurd.',
      confirmedBadge: 'Bevestigd',
      serviceLabel: 'Service',
      dateLabel: 'Datum',
      timeLabel: 'Tijd',
      durationLabel: 'Duur',
      durationUnit: 'minuten',
      technicianLabel: 'Technicus',
      importantTitle: 'Belangrijke informatie',
      importantText: 'Kom alstublieft een paar minuten eerder. Als u moet verzetten of annuleren, geef ons dan minimaal {{minimumNoticeHours}} uur van tevoren door.',
      addCalendarButton: 'Toevoegen aan agenda',
      contactText: 'Vragen? Neem contact met ons op via {{contactEmail}}{{#if contactPhone}} of {{contactPhone}}{{/if}}.'
    },
    requestDeclined: {
      subject: 'Update afspraakverzoek - {{serviceName}}',
      header: 'Update afspraakverzoek',
      greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}}, helaas konden we uw afspraakverzoek op het gewenste tijdstip niet accommoderen.',
      declinedBadge: 'Niet beschikbaar',
      serviceLabel: 'Service',
      requestedDateLabel: 'Gewenste datum',
      requestedTimeLabel: 'Gewenste tijd',
      reasonTitle: 'Reden',
      apologyText: 'Onze excuses voor het ongemak. U kunt gerust een nieuw verzoek indienen voor een ander tijdstip.',
      newRequestButton: 'Nieuwe afspraak aanvragen',
      contactText: 'Vragen? Neem contact met ons op via {{contactEmail}}{{#if contactPhone}} of {{contactPhone}}{{/if}}.'
    },
    newRequest: {
      subject: 'Nieuw afspraakverzoek - {{serviceName}} van {{requesterName}}',
      header: 'Nieuw afspraakverzoek',
      greeting: 'Er is een nieuw afspraakverzoek ingediend{{#if clientName}} voor <strong>{{clientName}}</strong>{{/if}}. Bekijk dit en neem passende actie.',
      greetingText: 'Er is een nieuw afspraakverzoek ingediend{{#if clientName}} voor {{clientName}}{{/if}}. Bekijk dit en neem passende actie.',
      pendingBadge: 'Wacht op beoordeling',
      requesterLabel: 'Aanvrager',
      companyLabel: 'Bedrijf',
      serviceLabel: 'Service',
      requestedDateLabel: 'Gewenste datum',
      requestedTimeLabel: 'Gewenste tijd',
      durationLabel: 'Duur',
      durationUnit: 'minuten',
      preferredTechLabel: 'Voorkeurstechnicus',
      notesTitle: 'Aanvullende opmerkingen',
      actionText: 'Bekijk dit verzoek en neem passende actie. De aanvrager wacht op bevestiging.',
      reviewButton: 'Beoordelen en goedkeuren'
    },
    footer: 'Powered by Alga PSA'
  }
};

// Generate HTML for appointment-request-received
function generateRequestReceivedHtml(t) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">${t.header}</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{serviceName}}</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">${t.refLabel} #{{referenceNumber}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${t.greeting}</p>
            <div style="margin-bottom:24px;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">${t.refLabel} #{{referenceNumber}}</div>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${t.serviceLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{serviceName}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.requestedDateLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{requestedDate}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.requestedTimeLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{requestedTime}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">${t.durationLabel}</td>
                <td style="padding:12px 0;">{{duration}} ${t.durationUnit}</td>
              </tr>
            </table>
            <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
              <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">${t.whatNextTitle}</div>
              <div style="color:#475467;line-height:1.5;">${t.whatNextText}</div>
            </div>
            <p style="margin:16px 0;font-size:14px;color:#667085;">${t.contactText}</p>
            <a href="{{portalLink}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${t.viewPortalButton}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Generate text for appointment-request-received
function generateRequestReceivedText(t) {
  return `${t.header}

${t.greeting.replace(/{{#if requesterName}} {{requesterName}}{{\/if}}/g, '{{#if requesterName}} {{requesterName}}{{/if}}')}

${t.refLabel}: {{referenceNumber}}

${t.serviceLabel}: {{serviceName}}
${t.requestedDateLabel}: {{requestedDate}}
${t.requestedTimeLabel}: {{requestedTime}}
${t.durationLabel}: {{duration}} ${t.durationUnit}

${t.whatNextTitle}
${t.whatNextText}

${t.contactText}

${t.viewPortalButton}: {{portalLink}}`;
}

// Generate HTML for appointment-request-approved
function generateRequestApprovedHtml(t) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">${t.header}</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{serviceName}}</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{appointmentDate}} • {{appointmentTime}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${t.greeting}</p>
            <div style="margin-bottom:24px;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">${t.confirmedBadge}</div>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${t.serviceLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{serviceName}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.dateLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{appointmentDate}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.timeLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{appointmentTime}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.durationLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{duration}} ${t.durationUnit}</td>
              </tr>
              {{#if technicianName}}
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">${t.technicianLabel}</td>
                <td style="padding:12px 0;">
                  <div style="font-weight:600;">{{technicianName}}</div>
                  {{#if technicianEmail}}<div style="color:#667085;font-size:13px;">{{technicianEmail}}</div>{{/if}}
                </td>
              </tr>
              {{/if}}
            </table>
            <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
              <div style="font-weight:600;color:#047857;margin-bottom:8px;">${t.importantTitle}</div>
              <div style="color:#475467;line-height:1.5;">${t.importantText}</div>
            </div>
            {{#if calendarLink}}
            <a href="{{calendarLink}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;margin-right:8px;">${t.addCalendarButton}</a>
            {{/if}}
            <p style="margin:16px 0;font-size:14px;color:#667085;">${t.contactText}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Generate text for appointment-request-approved
function generateRequestApprovedText(t) {
  return `${t.header}

${t.greeting.replace(/{{#if requesterName}} {{requesterName}}{{\/if}}/g, '{{#if requesterName}} {{requesterName}}{{/if}}')}

${t.serviceLabel}: {{serviceName}}
${t.dateLabel}: {{appointmentDate}}
${t.timeLabel}: {{appointmentTime}}
${t.durationLabel}: {{duration}} ${t.durationUnit}
{{#if technicianName}}${t.technicianLabel}: {{technicianName}}{{/if}}

${t.importantTitle}
${t.importantText}

{{#if calendarLink}}${t.addCalendarButton}: {{calendarLink}}{{/if}}

${t.contactText}`;
}

// Generate HTML for appointment-request-declined
function generateRequestDeclinedHtml(t) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">${t.header}</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{serviceName}}</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{referenceNumber}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${t.greeting}</p>
            <div style="margin-bottom:24px;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(239,68,68,0.12);color:#dc2626;font-size:12px;font-weight:600;letter-spacing:0.02em;">${t.declinedBadge}</div>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${t.serviceLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{serviceName}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.requestedDateLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{requestedDate}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">${t.requestedTimeLabel}</td>
                <td style="padding:12px 0;">{{requestedTime}}</td>
              </tr>
            </table>
            {{#if declineReason}}
            <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#fef2f2;border:1px solid #fecaca;">
              <div style="font-weight:600;color:#dc2626;margin-bottom:8px;">${t.reasonTitle}</div>
              <div style="color:#475467;line-height:1.5;">{{declineReason}}</div>
            </div>
            {{/if}}
            <p style="margin:16px 0;font-size:14px;color:#667085;">${t.apologyText}</p>
            {{#if requestNewAppointmentLink}}
            <a href="{{requestNewAppointmentLink}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${t.newRequestButton}</a>
            {{/if}}
            <p style="margin:16px 0;font-size:14px;color:#667085;">${t.contactText}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Generate text for appointment-request-declined
function generateRequestDeclinedText(t) {
  return `${t.header}

${t.greeting.replace(/{{#if requesterName}} {{requesterName}}{{\/if}}/g, '{{#if requesterName}} {{requesterName}}{{/if}}')}

${t.serviceLabel}: {{serviceName}}
${t.requestedDateLabel}: {{requestedDate}}
${t.requestedTimeLabel}: {{requestedTime}}

{{#if declineReason}}${t.reasonTitle}:
{{declineReason}}{{/if}}

${t.apologyText}

{{#if requestNewAppointmentLink}}${t.newRequestButton}: {{requestNewAppointmentLink}}{{/if}}

${t.contactText}`;
}

// Generate HTML for new-appointment-request (to MSP staff)
function generateNewRequestHtml(t) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">${t.header}</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{serviceName}}</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">#{{referenceNumber}} • {{submittedAt}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${t.greeting}</p>
            <div style="margin-bottom:24px;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(245,158,11,0.12);color:#d97706;font-size:12px;font-weight:600;letter-spacing:0.02em;">${t.pendingBadge}</div>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${t.requesterLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <div style="font-weight:600;">{{requesterName}}</div>
                  <div style="color:#667085;font-size:13px;">{{requesterEmail}}</div>
                  {{#if requesterPhone}}<div style="color:#667085;font-size:13px;">{{requesterPhone}}</div>{{/if}}
                </td>
              </tr>
              {{#if clientName}}
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.companyLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{clientName}}</td>
              </tr>
              {{/if}}
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.serviceLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{serviceName}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.requestedDateLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{requestedDate}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.requestedTimeLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{requestedTime}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.durationLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{duration}} ${t.durationUnit}</td>
              </tr>
              {{#if preferredTechnician}}
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">${t.preferredTechLabel}</td>
                <td style="padding:12px 0;">{{preferredTechnician}}</td>
              </tr>
              {{/if}}
            </table>
            {{#if description}}
            <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
              <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">${t.notesTitle}</div>
              <div style="color:#475467;line-height:1.5;">{{description}}</div>
            </div>
            {{/if}}
            <div style="margin:20px 0;padding:16px 20px;border-radius:12px;background:#fff9e6;border:1px solid #ffe4a3;">
              <div style="color:#92400e;line-height:1.5;font-size:14px;">${t.actionText}</div>
            </div>
            {{#if approvalLink}}
            <a href="{{approvalLink}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${t.reviewButton}</a>
            {{/if}}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Generate text for new-appointment-request
function generateNewRequestText(t) {
  return `${t.header}

${t.greetingText}

${t.requesterLabel}:
{{requesterName}}
{{requesterEmail}}
{{#if requesterPhone}}{{requesterPhone}}{{/if}}

{{#if clientName}}${t.companyLabel}: {{clientName}}{{/if}}

${t.serviceLabel}: {{serviceName}}
${t.requestedDateLabel}: {{requestedDate}}
${t.requestedTimeLabel}: {{requestedTime}}
${t.durationLabel}: {{duration}} ${t.durationUnit}
{{#if preferredTechnician}}${t.preferredTechLabel}: {{preferredTechnician}}{{/if}}

#{{referenceNumber}} • {{submittedAt}}

{{#if description}}${t.notesTitle}:
{{description}}{{/if}}

${t.actionText}

{{#if approvalLink}}${t.reviewButton}: {{approvalLink}}{{/if}}`;
}

exports.up = async function(knex) {
  console.log('Adding/updating appointment email templates with modern styling for all languages...');

  // Ensure Appointments category exists
  let appointmentsCategory = await knex('notification_categories')
    .where({ name: 'Appointments' })
    .first();

  if (!appointmentsCategory) {
    [appointmentsCategory] = await knex('notification_categories')
      .insert({
        name: 'Appointments',
        description: 'Appointment request and scheduling notifications',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    console.log('  Created Appointments notification category');
  }

  // Create notification subtypes for appointment requests
  const subtypeNames = {
    'appointment-request-received': 'Confirmation that appointment request was received',
    'appointment-request-approved': 'Notification that appointment request was approved',
    'appointment-request-declined': 'Notification that appointment request was declined',
    'new-appointment-request': 'New appointment request notification for MSP staff'
  };

  const subtypeIds = {};

  for (const [name, description] of Object.entries(subtypeNames)) {
    let subtype = await knex('notification_subtypes')
      .where({ name })
      .first();

    if (!subtype) {
      [subtype] = await knex('notification_subtypes')
        .insert({
          category_id: appointmentsCategory.id,
          name,
          description,
          is_enabled: true,
          is_default_enabled: true
        })
        .returning('*');
      console.log(`  Created notification subtype: ${name}`);
    }

    subtypeIds[name] = subtype.id;
  }

  const languages = ['en', 'de', 'es', 'fr', 'it', 'nl'];
  let createdCount = 0;
  let updatedCount = 0;

  for (const lang of languages) {
    const t = translations[lang];

    // Upsert appointment-request-received
    const received = await knex('system_email_templates')
      .where({ name: 'appointment-request-received', language_code: lang })
      .first();

    if (received) {
      await knex('system_email_templates')
        .where({ id: received.id })
        .update({
          subject: t.requestReceived.subject,
          html_content: generateRequestReceivedHtml(t.requestReceived),
          text_content: generateRequestReceivedText(t.requestReceived),
          updated_at: new Date()
        });
      updatedCount++;
      console.log(`  Updated: appointment-request-received (${lang})`);
    } else {
      await knex('system_email_templates').insert({
        name: 'appointment-request-received',
        language_code: lang,
        subject: t.requestReceived.subject,
        html_content: generateRequestReceivedHtml(t.requestReceived),
        text_content: generateRequestReceivedText(t.requestReceived),
        notification_subtype_id: subtypeIds['appointment-request-received'],
        created_at: new Date(),
        updated_at: new Date()
      });
      createdCount++;
      console.log(`  Created: appointment-request-received (${lang})`);
    }

    // Upsert appointment-request-approved
    const approved = await knex('system_email_templates')
      .where({ name: 'appointment-request-approved', language_code: lang })
      .first();

    if (approved) {
      await knex('system_email_templates')
        .where({ id: approved.id })
        .update({
          subject: t.requestApproved.subject,
          html_content: generateRequestApprovedHtml(t.requestApproved),
          text_content: generateRequestApprovedText(t.requestApproved),
          updated_at: new Date()
        });
      updatedCount++;
      console.log(`  Updated: appointment-request-approved (${lang})`);
    } else {
      await knex('system_email_templates').insert({
        name: 'appointment-request-approved',
        language_code: lang,
        subject: t.requestApproved.subject,
        html_content: generateRequestApprovedHtml(t.requestApproved),
        text_content: generateRequestApprovedText(t.requestApproved),
        notification_subtype_id: subtypeIds['appointment-request-approved'],
        created_at: new Date(),
        updated_at: new Date()
      });
      createdCount++;
      console.log(`  Created: appointment-request-approved (${lang})`);
    }

    // Upsert appointment-request-declined
    const declined = await knex('system_email_templates')
      .where({ name: 'appointment-request-declined', language_code: lang })
      .first();

    if (declined) {
      await knex('system_email_templates')
        .where({ id: declined.id })
        .update({
          subject: t.requestDeclined.subject,
          html_content: generateRequestDeclinedHtml(t.requestDeclined),
          text_content: generateRequestDeclinedText(t.requestDeclined),
          updated_at: new Date()
        });
      updatedCount++;
      console.log(`  Updated: appointment-request-declined (${lang})`);
    } else {
      await knex('system_email_templates').insert({
        name: 'appointment-request-declined',
        language_code: lang,
        subject: t.requestDeclined.subject,
        html_content: generateRequestDeclinedHtml(t.requestDeclined),
        text_content: generateRequestDeclinedText(t.requestDeclined),
        notification_subtype_id: subtypeIds['appointment-request-declined'],
        created_at: new Date(),
        updated_at: new Date()
      });
      createdCount++;
      console.log(`  Created: appointment-request-declined (${lang})`);
    }

    // Upsert new-appointment-request
    const newReq = await knex('system_email_templates')
      .where({ name: 'new-appointment-request', language_code: lang })
      .first();

    if (newReq) {
      await knex('system_email_templates')
        .where({ id: newReq.id })
        .update({
          subject: t.newRequest.subject,
          html_content: generateNewRequestHtml(t.newRequest),
          text_content: generateNewRequestText(t.newRequest),
          updated_at: new Date()
        });
      updatedCount++;
      console.log(`  Updated: new-appointment-request (${lang})`);
    } else {
      await knex('system_email_templates').insert({
        name: 'new-appointment-request',
        language_code: lang,
        subject: t.newRequest.subject,
        html_content: generateNewRequestHtml(t.newRequest),
        text_content: generateNewRequestText(t.newRequest),
        notification_subtype_id: subtypeIds['new-appointment-request'],
        created_at: new Date(),
        updated_at: new Date()
      });
      createdCount++;
      console.log(`  Created: new-appointment-request (${lang})`);
    }
  }

  console.log(`Successfully processed appointment email templates: ${createdCount} created, ${updatedCount} updated`);
};

exports.down = async function() {
  // Rollback would need the original templates from the original migration
  console.log('Rollback: Templates would need to be restored from the original migration');
  console.log('See migration 20251111123313_add_appointment_request_email_templates.cjs for original content');
};
