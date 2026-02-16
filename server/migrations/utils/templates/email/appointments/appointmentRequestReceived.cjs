/**
 * Source-of-truth: appointment-request-received email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'appointment-request-received';
const SUBTYPE_NAME = 'appointment-request-received';

const SUBJECTS = {
  en: 'Appointment Request Received - {{serviceName}}',
  fr: 'Demande de rendez-vous re\u00e7ue - {{serviceName}}',
  es: 'Solicitud de cita recibida - {{serviceName}}',
  de: 'Terminanfrage erhalten - {{serviceName}}',
  nl: 'Afspraakverzoek ontvangen - {{serviceName}}',
  it: 'Richiesta di appuntamento ricevuta - {{serviceName}}',
  pl: 'Wniosek o wizyt\u0119 otrzymany - {{serviceName}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Request Received',
    headerSub: "We've received your appointment request",
    greeting: 'Hello{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Thank you for submitting your appointment request. We have received your request and our team will review it shortly.',
    referencePrefix: 'Reference: ',
    detailsTitle: 'Request Details',
    service: 'Service:',
    requestedDate: 'Requested Date:',
    requestedTime: 'Requested Time:',
    duration: 'Duration:',
    durationUnit: 'minutes',
    preferredTechnician: 'Preferred Technician:',
    nextTitle: 'What happens next?',
    nextBody: 'Our team will review your request and confirm availability. You will receive an email notification once your appointment has been approved or if any changes are needed. We typically respond within {{responseTime}}.',
    contactMsg: 'If you have any questions or need to make changes to your request, please contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    // text-only
    textHeader: 'Appointment Request Received',
    textRefLabel: 'Reference Number',
    textDetailsHeader: 'REQUEST DETAILS',
    textService: 'Service',
    textRequestedDate: 'Requested Date',
    textRequestedTime: 'Requested Time',
    textDuration: 'Duration',
    textDurationUnit: 'minutes',
    textPreferredTechnician: 'Preferred Technician',
    textNextHeader: 'WHAT HAPPENS NEXT?',
  },
  fr: {
    headerLabel: 'Demande re\u00e7ue',
    headerSub: 'Nous avons re\u00e7u votre demande de rendez-vous',
    greeting: 'Bonjour{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: "Merci d'avoir soumis votre demande de rendez-vous. Nous avons bien re\u00e7u votre demande et notre \u00e9quipe l'examinera sous peu.",
    referencePrefix: 'R\u00e9f\u00e9rence : ',
    detailsTitle: 'D\u00e9tails de la demande',
    service: 'Service :',
    requestedDate: 'Date demand\u00e9e :',
    requestedTime: 'Heure demand\u00e9e :',
    duration: 'Dur\u00e9e :',
    durationUnit: 'minutes',
    preferredTechnician: 'Technicien pr\u00e9f\u00e9r\u00e9 :',
    nextTitle: 'Quelle est la prochaine \u00e9tape ?',
    nextBody: "Notre \u00e9quipe examinera votre demande et confirmera la disponibilit\u00e9. Vous recevrez une notification par e-mail une fois que votre rendez-vous aura \u00e9t\u00e9 approuv\u00e9 ou si des modifications sont n\u00e9cessaires. Nous r\u00e9pondons g\u00e9n\u00e9ralement dans un d\u00e9lai de {{responseTime}}.",
    contactMsg: "Si vous avez des questions ou si vous devez apporter des modifications \u00e0 votre demande, veuillez nous contacter \u00e0 {{contactEmail}}{{#if contactPhone}} ou appeler le {{contactPhone}}{{/if}}.",
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Demande de rendez-vous re\u00e7ue',
    textRefLabel: 'Num\u00e9ro de r\u00e9f\u00e9rence',
    textDetailsHeader: 'D\u00c9TAILS DE LA DEMANDE',
    textService: 'Service',
    textRequestedDate: 'Date demand\u00e9e',
    textRequestedTime: 'Heure demand\u00e9e',
    textDuration: 'Dur\u00e9e',
    textDurationUnit: 'minutes',
    textPreferredTechnician: 'Technicien pr\u00e9f\u00e9r\u00e9',
    textNextHeader: 'QUELLE EST LA PROCHAINE \u00c9TAPE ?',
  },
  es: {
    headerLabel: 'Solicitud recibida',
    headerSub: 'Hemos recibido su solicitud de cita',
    greeting: 'Hola{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Gracias por enviar su solicitud de cita. Hemos recibido su solicitud y nuestro equipo la revisar\u00e1 en breve.',
    referencePrefix: 'Referencia: ',
    detailsTitle: 'Detalles de la solicitud',
    service: 'Servicio:',
    requestedDate: 'Fecha solicitada:',
    requestedTime: 'Hora solicitada:',
    duration: 'Duraci\u00f3n:',
    durationUnit: 'minutos',
    preferredTechnician: 'T\u00e9cnico preferido:',
    nextTitle: '\u00bfQu\u00e9 sigue?',
    nextBody: 'Nuestro equipo revisar\u00e1 su solicitud y confirmar\u00e1 la disponibilidad. Recibir\u00e1 una notificaci\u00f3n por correo electr\u00f3nico una vez que su cita haya sido aprobada o si se necesitan cambios. Normalmente respondemos dentro de {{responseTime}}.',
    contactMsg: 'Si tiene alguna pregunta o necesita realizar cambios en su solicitud, por favor cont\u00e1ctenos en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Solicitud de cita recibida',
    textRefLabel: 'N\u00famero de referencia',
    textDetailsHeader: 'DETALLES DE LA SOLICITUD',
    textService: 'Servicio',
    textRequestedDate: 'Fecha solicitada',
    textRequestedTime: 'Hora solicitada',
    textDuration: 'Duraci\u00f3n',
    textDurationUnit: 'minutos',
    textPreferredTechnician: 'T\u00e9cnico preferido',
    textNextHeader: '\u00bfQU\u00c9 SIGUE?',
  },
  de: {
    headerLabel: 'Anfrage erhalten',
    headerSub: 'Wir haben Ihre Terminanfrage erhalten',
    greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Vielen Dank f\u00fcr Ihre Terminanfrage. Wir haben Ihre Anfrage erhalten und unser Team wird sie in K\u00fcrze pr\u00fcfen.',
    referencePrefix: 'Referenz: ',
    detailsTitle: 'Anfragedetails',
    service: 'Service:',
    requestedDate: 'Gew\u00fcnschtes Datum:',
    requestedTime: 'Gew\u00fcnschte Zeit:',
    duration: 'Dauer:',
    durationUnit: 'Minuten',
    preferredTechnician: 'Bevorzugter Techniker:',
    nextTitle: 'Wie geht es weiter?',
    nextBody: 'Unser Team wird Ihre Anfrage pr\u00fcfen und die Verf\u00fcgbarkeit best\u00e4tigen. Sie erhalten eine E-Mail-Benachrichtigung, sobald Ihr Termin genehmigt wurde oder falls \u00c4nderungen erforderlich sind. Wir antworten in der Regel innerhalb von {{responseTime}}.',
    contactMsg: 'Wenn Sie Fragen haben oder \u00c4nderungen an Ihrer Anfrage vornehmen m\u00f6chten, kontaktieren Sie uns bitte unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Terminanfrage erhalten',
    textRefLabel: 'Referenznummer',
    textDetailsHeader: 'ANFRAGEDETAILS',
    textService: 'Service',
    textRequestedDate: 'Gew\u00fcnschtes Datum',
    textRequestedTime: 'Gew\u00fcnschte Zeit',
    textDuration: 'Dauer',
    textDurationUnit: 'Minuten',
    textPreferredTechnician: 'Bevorzugter Techniker',
    textNextHeader: 'WIE GEHT ES WEITER?',
  },
  nl: {
    headerLabel: 'Verzoek ontvangen',
    headerSub: 'We hebben uw afspraakverzoek ontvangen',
    greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Bedankt voor het indienen van uw afspraakverzoek. We hebben uw verzoek ontvangen en ons team zal het binnenkort beoordelen.',
    referencePrefix: 'Referentie: ',
    detailsTitle: 'Verzoekdetails',
    service: 'Dienst:',
    requestedDate: 'Gevraagde datum:',
    requestedTime: 'Gevraagde tijd:',
    duration: 'Duur:',
    durationUnit: 'minuten',
    preferredTechnician: 'Voorkeurstechnicus:',
    nextTitle: 'Wat gebeurt er nu?',
    nextBody: 'Ons team zal uw verzoek beoordelen en de beschikbaarheid bevestigen. U ontvangt een e-mailmelding zodra uw afspraak is goedgekeurd of als er wijzigingen nodig zijn. We reageren doorgaans binnen {{responseTime}}.',
    contactMsg: 'Als u vragen heeft of wijzigingen in uw verzoek wilt aanbrengen, neem dan contact met ons op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Afspraakverzoek ontvangen',
    textRefLabel: 'Referentienummer',
    textDetailsHeader: 'VERZOEKDETAILS',
    textService: 'Dienst',
    textRequestedDate: 'Gevraagde datum',
    textRequestedTime: 'Gevraagde tijd',
    textDuration: 'Duur',
    textDurationUnit: 'minuten',
    textPreferredTechnician: 'Voorkeurstechnicus',
    textNextHeader: 'WAT GEBEURT ER NU?',
  },
  it: {
    headerLabel: 'Richiesta ricevuta',
    headerSub: 'Abbiamo ricevuto la tua richiesta di appuntamento',
    greeting: 'Ciao{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Grazie per aver inviato la tua richiesta di appuntamento. Abbiamo ricevuto la tua richiesta e il nostro team la esaminer\u00e0 a breve.',
    referencePrefix: 'Riferimento: ',
    detailsTitle: 'Dettagli della richiesta',
    service: 'Servizio:',
    requestedDate: 'Data richiesta:',
    requestedTime: 'Ora richiesta:',
    duration: 'Durata:',
    durationUnit: 'minuti',
    preferredTechnician: 'Tecnico preferito:',
    nextTitle: 'Cosa succede ora?',
    nextBody: "Il nostro team esaminer\u00e0 la tua richiesta e confermer\u00e0 la disponibilit\u00e0. Riceverai una notifica via email una volta che il tuo appuntamento sar\u00e0 stato approvato o se sono necessarie modifiche. Di solito rispondiamo entro {{responseTime}}.",
    contactMsg: "Se hai domande o desideri apportare modifiche alla tua richiesta, contattaci all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.",
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Richiesta di appuntamento ricevuta',
    textRefLabel: 'Numero di riferimento',
    textDetailsHeader: 'DETTAGLI DELLA RICHIESTA',
    textService: 'Servizio',
    textRequestedDate: 'Data richiesta',
    textRequestedTime: 'Ora richiesta',
    textDuration: 'Durata',
    textDurationUnit: 'minuti',
    textPreferredTechnician: 'Tecnico preferito',
    textNextHeader: 'COSA SUCCEDE ORA?',
  },
  pl: {
    headerLabel: 'Wniosek otrzymany',
    headerSub: 'Otrzymali\u015bmy Tw\u00f3j wniosek o wizyt\u0119',
    greeting: 'Witaj{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Dzi\u0119kujemy za z\u0142o\u017cenie wniosku o wizyt\u0119. Otrzymali\u015bmy Tw\u00f3j wniosek i nasz zesp\u00f3\u0142 wkr\u00f3tce go rozpatrzy.',
    referencePrefix: 'Numer referencyjny: ',
    detailsTitle: 'Szczeg\u00f3\u0142y wniosku',
    service: 'Us\u0142uga:',
    requestedDate: '\u017b\u0105dana data:',
    requestedTime: '\u017b\u0105dana godzina:',
    duration: 'Czas trwania:',
    durationUnit: 'minut',
    preferredTechnician: 'Preferowany technik:',
    nextTitle: 'Co dalej?',
    nextBody: 'Nasz zesp\u00f3\u0142 rozpatrzy Tw\u00f3j wniosek i potwierdzi dost\u0119pno\u015b\u0107. Otrzymasz powiadomienie email, gdy wizyta zostanie zatwierdzona lub je\u015bli b\u0119d\u0105 potrzebne zmiany. Zazwyczaj odpowiadamy w ci\u0105gu {{responseTime}}.',
    contactMsg: 'Je\u015bli masz pytania lub chcesz wprowadzi\u0107 zmiany do wniosku, skontaktuj si\u0119 z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwo\u0144 pod {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA',
    textHeader: 'Wniosek o wizyt\u0119 otrzymany',
    textRefLabel: 'Numer referencyjny',
    textDetailsHeader: 'SZCZEG\u00d3\u0141Y WNIOSKU',
    textService: 'Us\u0142uga',
    textRequestedDate: '\u017b\u0105dana data',
    textRequestedTime: '\u017b\u0105dana godzina',
    textDuration: 'Czas trwania',
    textDurationUnit: 'minut',
    textPreferredTechnician: 'Preferowany technik',
    textNextHeader: 'CO DALEJ?',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:8px 16px;border-radius:6px;background:#ede9fe;color:#6d28d9;font-size:16px;font-weight:600;">${c.referencePrefix}{{referenceNumber}}</div>
                </div>
                <div style="margin:24px 0;padding:20px;border-left:4px solid ${BRAND_PRIMARY};background:${INFO_BOX_BG};border-radius:6px;">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:16px;font-size:16px;">${c.detailsTitle}</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#475467;width:160px;">${c.service}</td>
                      <td style="padding:8px 0;">{{serviceName}}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#475467;">${c.requestedDate}</td>
                      <td style="padding:8px 0;">{{requestedDate}}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#475467;">${c.requestedTime}</td>
                      <td style="padding:8px 0;">{{requestedTime}}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#475467;">${c.duration}</td>
                      <td style="padding:8px 0;">{{duration}} ${c.durationUnit}</td>
                    </tr>
                    {{#if preferredTechnician}}
                    <tr>
                      <td style="padding:8px 0;font-weight:600;color:#475467;">${c.preferredTechnician}</td>
                      <td style="padding:8px 0;">{{preferredTechnician}}</td>
                    </tr>
                    {{/if}}
                  </table>
                </div>
                <div style="margin:24px 0;padding:16px 20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">${c.nextTitle}</div>
                  <div style="color:#1e40af;font-size:14px;line-height:1.5;">${c.nextBody}</div>
                </div>
                <p style="margin:0 0 16px 0;font-size:15px;color:#475569;line-height:1.5;">${c.contactMsg}</p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.greeting}

${c.intro}

${c.textRefLabel}: {{referenceNumber}}

${c.textDetailsHeader}:
${c.textService}: {{serviceName}}
${c.textRequestedDate}: {{requestedDate}}
${c.textRequestedTime}: {{requestedTime}}
${c.textDuration}: {{duration}} ${c.textDurationUnit}
{{#if preferredTechnician}}${c.textPreferredTechnician}: {{preferredTechnician}}{{/if}}

${c.textNextHeader}
${c.nextBody}

${c.contactMsg}`;
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
        headerTitle: '{{serviceName}}',
        headerMeta: copy.headerSub,
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
