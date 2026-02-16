/**
 * Source-of-truth: new-appointment-request email template.
 *
 * Sent to MSP staff when a new appointment request is submitted.
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'new-appointment-request';
const SUBTYPE_NAME = 'new-appointment-request';

const SUBJECTS = {
  en: 'New Appointment Request - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
  fr: 'Nouvelle demande de rendez-vous - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
  es: 'Nueva solicitud de cita - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
  de: 'Neue Terminanfrage - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
  nl: 'Nieuw afspraakverzoek - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
  it: 'Nuova richiesta di appuntamento - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
  pl: 'Nowy wniosek o wizyt\u0119 - {{clientName}}{{#if serviceName}} - {{serviceName}}{{/if}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'New Appointment Request',
    headerSub: 'Action Required',
    greeting: 'Team,',
    intro: 'A new appointment request has been submitted and requires your review and approval.',
    requesterTitle: 'Requester Information',
    requesterEmail: 'Email:',
    requesterPhone: 'Phone:',
    company: 'Company:',
    client: 'Client:',
    requestTitle: 'Request Details',
    referenceLabel: 'Reference:',
    submittedLabel: 'Submitted:',
    ticketLabel: 'Ticket:',
    appointmentTitle: 'Appointment Details',
    service: 'Service:',
    requestedDate: 'Requested Date:',
    requestedTime: 'Requested Time:',
    duration: 'Duration:',
    durationUnit: 'minutes',
    preferredTechnician: 'Preferred Technician:',
    notesTitle: 'Additional Notes',
    reviewButton: 'Review & Approve',
    reviewMsg: 'Please review this request and take appropriate action. The requester is waiting for confirmation.',
    referenceMsg: 'Request reference: {{referenceNumber}}',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    // text-only
    textHeader: 'New Appointment Request - Action Required',
    textRequesterHeader: 'REQUESTER INFORMATION',
    textName: 'Name',
    textEmail: 'Email',
    textPhone: 'Phone',
    textCompany: 'Company',
    textClient: 'Client',
    textRequestHeader: 'REQUEST DETAILS',
    textReference: 'Reference',
    textSubmitted: 'Submitted',
    textTicket: 'Ticket',
    textType: 'Type',
    textTypeAuth: 'Client Portal Request',
    textTypePublic: 'Public Request',
    textAppointmentHeader: 'APPOINTMENT DETAILS',
    textService: 'Service',
    textRequestedDate: 'Requested Date',
    textRequestedTime: 'Requested Time',
    textDuration: 'Duration',
    textDurationUnit: 'minutes',
    textPreferredTechnician: 'Preferred Technician',
    textNotesHeader: 'ADDITIONAL NOTES',
    textReviewHeader: 'REVIEW & APPROVE',
  },
  fr: {
    headerLabel: 'Nouvelle demande de rendez-vous',
    headerSub: 'Action requise',
    greeting: 'Bonjour,',
    intro: 'Une nouvelle demande de rendez-vous a \u00e9t\u00e9 soumise et n\u00e9cessite votre examen.',
    requesterTitle: 'Informations du demandeur',
    requesterEmail: 'E-mail :',
    requesterPhone: 'T\u00e9l\u00e9phone :',
    company: 'Entreprise :',
    client: 'Client :',
    requestTitle: 'D\u00e9tails de la demande',
    referenceLabel: 'R\u00e9f\u00e9rence :',
    submittedLabel: 'Soumis :',
    ticketLabel: 'Ticket :',
    appointmentTitle: 'D\u00e9tails du rendez-vous',
    service: 'Service :',
    requestedDate: 'Date demand\u00e9e :',
    requestedTime: 'Heure demand\u00e9e :',
    duration: 'Dur\u00e9e :',
    durationUnit: 'minutes',
    preferredTechnician: 'Technicien pr\u00e9f\u00e9r\u00e9 :',
    notesTitle: 'Notes du client',
    reviewButton: 'Examiner et r\u00e9pondre',
    reviewMsg: 'Veuillez examiner cette demande et prendre les mesures appropri\u00e9es.',
    referenceMsg: 'R\u00e9f\u00e9rence de la demande : {{referenceNumber}}',
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Nouvelle demande de rendez-vous',
    textRequesterHeader: 'INFORMATIONS DU DEMANDEUR',
    textName: 'Nom',
    textEmail: 'E-mail',
    textPhone: 'T\u00e9l\u00e9phone',
    textCompany: 'Entreprise',
    textClient: 'Client',
    textRequestHeader: 'D\u00c9TAILS DE LA DEMANDE',
    textReference: 'R\u00e9f\u00e9rence',
    textSubmitted: 'Soumis',
    textTicket: 'Ticket',
    textType: 'Type',
    textTypeAuth: 'Demande portail client',
    textTypePublic: 'Demande publique',
    textAppointmentHeader: 'D\u00c9TAILS DU RENDEZ-VOUS',
    textService: 'Service',
    textRequestedDate: 'Date demand\u00e9e',
    textRequestedTime: 'Heure demand\u00e9e',
    textDuration: 'Dur\u00e9e',
    textDurationUnit: 'minutes',
    textPreferredTechnician: 'Technicien pr\u00e9f\u00e9r\u00e9',
    textNotesHeader: 'NOTES DU CLIENT',
    textReviewHeader: 'EXAMINER ET R\u00c9PONDRE',
  },
  es: {
    headerLabel: 'Nueva solicitud de cita',
    headerSub: 'Acci\u00f3n requerida',
    greeting: 'Equipo,',
    intro: 'Se ha enviado una nueva solicitud de cita y requiere su revisi\u00f3n.',
    requesterTitle: 'Informaci\u00f3n del solicitante',
    requesterEmail: 'Correo:',
    requesterPhone: 'Tel\u00e9fono:',
    company: 'Empresa:',
    client: 'Cliente:',
    requestTitle: 'Detalles de la solicitud',
    referenceLabel: 'Referencia:',
    submittedLabel: 'Enviado:',
    ticketLabel: 'Ticket:',
    appointmentTitle: 'Detalles de la cita',
    service: 'Servicio:',
    requestedDate: 'Fecha solicitada:',
    requestedTime: 'Hora solicitada:',
    duration: 'Duraci\u00f3n:',
    durationUnit: 'minutos',
    preferredTechnician: 'T\u00e9cnico preferido:',
    notesTitle: 'Notas del cliente',
    reviewButton: 'Revisar y responder',
    reviewMsg: 'Por favor revise esta solicitud y tome las medidas apropiadas.',
    referenceMsg: 'Referencia de la solicitud: {{referenceNumber}}',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Nueva solicitud de cita',
    textRequesterHeader: 'INFORMACI\u00d3N DEL SOLICITANTE',
    textName: 'Nombre',
    textEmail: 'Correo',
    textPhone: 'Tel\u00e9fono',
    textCompany: 'Empresa',
    textClient: 'Cliente',
    textRequestHeader: 'DETALLES DE LA SOLICITUD',
    textReference: 'Referencia',
    textSubmitted: 'Enviado',
    textTicket: 'Ticket',
    textType: 'Tipo',
    textTypeAuth: 'Solicitud del portal',
    textTypePublic: 'Solicitud p\u00fablica',
    textAppointmentHeader: 'DETALLES DE LA CITA',
    textService: 'Servicio',
    textRequestedDate: 'Fecha solicitada',
    textRequestedTime: 'Hora solicitada',
    textDuration: 'Duraci\u00f3n',
    textDurationUnit: 'minutos',
    textPreferredTechnician: 'T\u00e9cnico preferido',
    textNotesHeader: 'NOTAS DEL CLIENTE',
    textReviewHeader: 'REVISAR Y RESPONDER',
  },
  de: {
    headerLabel: 'Neue Terminanfrage',
    headerSub: 'Aktion erforderlich',
    greeting: 'Team,',
    intro: 'Eine neue Terminanfrage wurde eingereicht und erfordert Ihre Pr\u00fcfung.',
    requesterTitle: 'Antragsteller-Informationen',
    requesterEmail: 'E-Mail:',
    requesterPhone: 'Telefon:',
    company: 'Unternehmen:',
    client: 'Kunde:',
    requestTitle: 'Anfragedetails',
    referenceLabel: 'Referenz:',
    submittedLabel: 'Eingereicht:',
    ticketLabel: 'Ticket:',
    appointmentTitle: 'Termindetails',
    service: 'Service:',
    requestedDate: 'Gew\u00fcnschtes Datum:',
    requestedTime: 'Gew\u00fcnschte Zeit:',
    duration: 'Dauer:',
    durationUnit: 'Minuten',
    preferredTechnician: 'Bevorzugter Techniker:',
    notesTitle: 'Kundennotizen',
    reviewButton: 'Pr\u00fcfen und antworten',
    reviewMsg: 'Bitte pr\u00fcfen Sie diese Anfrage und ergreifen Sie die entsprechenden Ma\u00dfnahmen.',
    referenceMsg: 'Anfragereferenz: {{referenceNumber}}',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Neue Terminanfrage',
    textRequesterHeader: 'ANTRAGSTELLER-INFORMATIONEN',
    textName: 'Name',
    textEmail: 'E-Mail',
    textPhone: 'Telefon',
    textCompany: 'Unternehmen',
    textClient: 'Kunde',
    textRequestHeader: 'ANFRAGEDETAILS',
    textReference: 'Referenz',
    textSubmitted: 'Eingereicht',
    textTicket: 'Ticket',
    textType: 'Typ',
    textTypeAuth: 'Kundenportal-Anfrage',
    textTypePublic: '\u00d6ffentliche Anfrage',
    textAppointmentHeader: 'TERMINDETAILS',
    textService: 'Service',
    textRequestedDate: 'Gew\u00fcnschtes Datum',
    textRequestedTime: 'Gew\u00fcnschte Zeit',
    textDuration: 'Dauer',
    textDurationUnit: 'Minuten',
    textPreferredTechnician: 'Bevorzugter Techniker',
    textNotesHeader: 'KUNDENNOTIZEN',
    textReviewHeader: 'PR\u00dcFEN UND ANTWORTEN',
  },
  nl: {
    headerLabel: 'Nieuw afspraakverzoek',
    headerSub: 'Actie vereist',
    greeting: 'Team,',
    intro: 'Er is een nieuw afspraakverzoek ingediend dat uw beoordeling vereist.',
    requesterTitle: 'Aanvragerinformatie',
    requesterEmail: 'E-mail:',
    requesterPhone: 'Telefoon:',
    company: 'Bedrijf:',
    client: 'Klant:',
    requestTitle: 'Verzoekdetails',
    referenceLabel: 'Referentie:',
    submittedLabel: 'Ingediend:',
    ticketLabel: 'Ticket:',
    appointmentTitle: 'Afspraakdetails',
    service: 'Dienst:',
    requestedDate: 'Gevraagde datum:',
    requestedTime: 'Gevraagde tijd:',
    duration: 'Duur:',
    durationUnit: 'minuten',
    preferredTechnician: 'Voorkeurstechnicus:',
    notesTitle: 'Klantnotities',
    reviewButton: 'Beoordelen en reageren',
    reviewMsg: 'Beoordeel dit verzoek en onderneem de juiste actie.',
    referenceMsg: 'Verzoekreferentie: {{referenceNumber}}',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Nieuw afspraakverzoek',
    textRequesterHeader: 'AANVRAGERINFORMATIE',
    textName: 'Naam',
    textEmail: 'E-mail',
    textPhone: 'Telefoon',
    textCompany: 'Bedrijf',
    textClient: 'Klant',
    textRequestHeader: 'VERZOEKDETAILS',
    textReference: 'Referentie',
    textSubmitted: 'Ingediend',
    textTicket: 'Ticket',
    textType: 'Type',
    textTypeAuth: 'Klantportaalverzoek',
    textTypePublic: 'Openbaar verzoek',
    textAppointmentHeader: 'AFSPRAAKDETAILS',
    textService: 'Dienst',
    textRequestedDate: 'Gevraagde datum',
    textRequestedTime: 'Gevraagde tijd',
    textDuration: 'Duur',
    textDurationUnit: 'minuten',
    textPreferredTechnician: 'Voorkeurstechnicus',
    textNotesHeader: 'KLANTNOTITIES',
    textReviewHeader: 'BEOORDELEN EN REAGEREN',
  },
  it: {
    headerLabel: 'Nuova richiesta di appuntamento',
    headerSub: 'Azione richiesta',
    greeting: 'Team,',
    intro: '\u00c8 stata inviata una nuova richiesta di appuntamento che richiede la tua revisione.',
    requesterTitle: 'Informazioni richiedente',
    requesterEmail: 'Email:',
    requesterPhone: 'Telefono:',
    company: 'Azienda:',
    client: 'Cliente:',
    requestTitle: 'Dettagli richiesta',
    referenceLabel: 'Riferimento:',
    submittedLabel: 'Inviata:',
    ticketLabel: 'Ticket:',
    appointmentTitle: 'Dettagli appuntamento',
    service: 'Servizio:',
    requestedDate: 'Data richiesta:',
    requestedTime: 'Ora richiesta:',
    duration: 'Durata:',
    durationUnit: 'minuti',
    preferredTechnician: 'Tecnico preferito:',
    notesTitle: 'Note del cliente',
    reviewButton: 'Rivedi e rispondi',
    reviewMsg: 'Si prega di rivedere questa richiesta e intraprendere le azioni appropriate.',
    referenceMsg: 'Riferimento richiesta: {{referenceNumber}}',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Nuova richiesta di appuntamento',
    textRequesterHeader: 'INFORMAZIONI RICHIEDENTE',
    textName: 'Nome',
    textEmail: 'Email',
    textPhone: 'Telefono',
    textCompany: 'Azienda',
    textClient: 'Cliente',
    textRequestHeader: 'DETTAGLI RICHIESTA',
    textReference: 'Riferimento',
    textSubmitted: 'Inviata',
    textTicket: 'Ticket',
    textType: 'Tipo',
    textTypeAuth: 'Richiesta portale cliente',
    textTypePublic: 'Richiesta pubblica',
    textAppointmentHeader: 'DETTAGLI APPUNTAMENTO',
    textService: 'Servizio',
    textRequestedDate: 'Data richiesta',
    textRequestedTime: 'Ora richiesta',
    textDuration: 'Durata',
    textDurationUnit: 'minuti',
    textPreferredTechnician: 'Tecnico preferito',
    textNotesHeader: 'NOTE DEL CLIENTE',
    textReviewHeader: 'RIVEDI E RISPONDI',
  },
  pl: {
    headerLabel: 'Nowy wniosek o wizyt\u0119',
    headerSub: 'Wymagana akcja',
    greeting: 'Zespole,',
    intro: 'Wp\u0142yn\u0105\u0142 nowy wniosek o wizyt\u0119 wymagaj\u0105cy przegl\u0105du i zatwierdzenia.',
    requesterTitle: 'Informacje o wnioskodawcy',
    requesterEmail: 'Email:',
    requesterPhone: 'Telefon:',
    company: 'Firma:',
    client: 'Klient:',
    requestTitle: 'Szczeg\u00f3\u0142y wniosku',
    referenceLabel: 'Referencja:',
    submittedLabel: 'Z\u0142o\u017cono:',
    ticketLabel: 'Zg\u0142oszenie:',
    appointmentTitle: 'Szczeg\u00f3\u0142y wizyty',
    service: 'Us\u0142uga:',
    requestedDate: '\u017b\u0105dana data:',
    requestedTime: '\u017b\u0105dana godzina:',
    duration: 'Czas trwania:',
    durationUnit: 'minut',
    preferredTechnician: 'Preferowany technik:',
    notesTitle: 'Dodatkowe uwagi',
    reviewButton: 'Przejrzyj i zatwierd\u017a',
    reviewMsg: 'Prosz\u0119 przejrze\u0107 ten wniosek i podj\u0105\u0107 odpowiednie dzia\u0142ania. Wnioskodawca czeka na potwierdzenie.',
    referenceMsg: 'Referencja wniosku: {{referenceNumber}}',
    footer: 'Powered by Alga PSA',
    textHeader: 'Nowy wniosek o wizyt\u0119 - Wymagana akcja',
    textRequesterHeader: 'INFORMACJE O WNIOSKODAWCY',
    textName: 'Imi\u0119',
    textEmail: 'Email',
    textPhone: 'Telefon',
    textCompany: 'Firma',
    textClient: 'Klient',
    textRequestHeader: 'SZCZEG\u00d3\u0141Y WNIOSKU',
    textReference: 'Referencja',
    textSubmitted: 'Z\u0142o\u017cono',
    textTicket: 'Zg\u0142oszenie',
    textType: 'Typ',
    textTypeAuth: 'Wniosek z portalu klienta',
    textTypePublic: 'Wniosek publiczny',
    textAppointmentHeader: 'SZCZEG\u00d3\u0141Y WIZYTY',
    textService: 'Us\u0142uga',
    textRequestedDate: '\u017b\u0105dana data',
    textRequestedTime: '\u017b\u0105dana godzina',
    textDuration: 'Czas trwania',
    textDurationUnit: 'minut',
    textPreferredTechnician: 'Preferowany technik',
    textNotesHeader: 'DODATKOWE UWAGI',
    textReviewHeader: 'PRZEJRZYJ I ZATWIERD\u0179',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin:24px 0;padding:20px;border-left:4px solid ${BRAND_PRIMARY};background:${INFO_BOX_BG};border-radius:6px;">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:16px;font-size:16px;">${c.requesterTitle}</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                    <tr>
                      <td style="padding:4px 0;"><strong>{{requesterName}}</strong></td>
                    </tr>
                    <tr>
                      <td style="padding:4px 0;">{{requesterEmail}}</td>
                    </tr>
                    {{#if requesterPhone}}
                    <tr>
                      <td style="padding:4px 0;">{{requesterPhone}}</td>
                    </tr>
                    {{/if}}
                    {{#if companyName}}
                    <tr>
                      <td style="padding:4px 0;">${c.company} {{companyName}}</td>
                    </tr>
                    {{/if}}
                    {{#if clientName}}
                    <tr>
                      <td style="padding:4px 0;">${c.client} {{clientName}}</td>
                    </tr>
                    {{/if}}
                  </table>
                </div>
                <div style="margin:24px 0;padding:20px;border-left:4px solid #f59e0b;background:#fef3c7;border-radius:6px;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:16px;font-size:16px;">${c.appointmentTitle}</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#78350f;width:160px;">${c.service}</td>
                      <td style="padding:8px 0;">{{serviceName}}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#78350f;">${c.requestedDate}</td>
                      <td style="padding:8px 0;">{{requestedDate}}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#78350f;">${c.requestedTime}</td>
                      <td style="padding:8px 0;">{{requestedTime}}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#78350f;">${c.duration}</td>
                      <td style="padding:8px 0;">{{duration}} ${c.durationUnit}</td>
                    </tr>
                    {{#if preferredTechnician}}
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#78350f;">${c.preferredTechnician}</td>
                      <td style="padding:8px 0;">{{preferredTechnician}}</td>
                    </tr>
                    {{/if}}
                  </table>
                </div>
                {{#if description}}
                <div style="margin:24px 0;padding:16px 20px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0;">
                  <div style="font-weight:600;color:#475569;margin-bottom:8px;font-size:14px;">${c.notesTitle}</div>
                  <div style="color:#1e293b;font-size:14px;font-style:italic;">"{{description}}"</div>
                </div>
                {{/if}}
                {{#if approvalLink}}
                <div style="text-align:center;margin:24px 0;">
                  <a href="{{approvalLink}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600;font-size:15px;">${c.reviewButton}</a>
                </div>
                {{/if}}
                <p style="margin:0;font-size:14px;color:#64748b;text-align:center;line-height:1.5;">${c.reviewMsg}</p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.greeting}

${c.intro}

${c.textRequesterHeader}:
${c.textName}: {{requesterName}}
${c.textEmail}: {{requesterEmail}}
{{#if requesterPhone}}${c.textPhone}: {{requesterPhone}}{{/if}}
{{#if companyName}}${c.textCompany}: {{companyName}}{{/if}}
{{#if clientName}}${c.textClient}: {{clientName}}{{/if}}

${c.textAppointmentHeader}:
${c.textService}: {{serviceName}}
${c.textRequestedDate}: {{requestedDate}}
${c.textRequestedTime}: {{requestedTime}}
${c.textDuration}: {{duration}} ${c.textDurationUnit}
{{#if preferredTechnician}}${c.textPreferredTechnician}: {{preferredTechnician}}{{/if}}

{{#if description}}
${c.textNotesHeader}:
"{{description}}"
{{/if}}

${c.referenceMsg}

{{#if approvalLink}}
${c.textReviewHeader}:
{{approvalLink}}
{{/if}}

${c.reviewMsg}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: SUBJECTS[lang],
      htmlContent: wrapEmailLayout({
        language: lang,
        headerLabel: copy.headerLabel,
        headerTitle: '{{clientName}}',
        headerMeta: copy.headerSub,
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
