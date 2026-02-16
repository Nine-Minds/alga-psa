/**
 * Source-of-truth: appointment-request-declined email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'appointment-request-declined';
const SUBTYPE_NAME = 'appointment-request-declined';

const SUBJECTS = {
  en: 'Appointment Request Update - {{serviceName}}',
  fr: 'Mise \u00e0 jour de la demande de rendez-vous - {{serviceName}}',
  es: 'Actualizaci\u00f3n de solicitud de cita - {{serviceName}}',
  de: 'Aktualisierung Ihrer Terminanfrage - {{serviceName}}',
  nl: 'Update afspraakverzoek - {{serviceName}}',
  it: 'Aggiornamento richiesta di appuntamento - {{serviceName}}',
  pl: 'Aktualizacja wniosku o wizyt\u0119 - {{serviceName}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Appointment Request Update',
    headerSub: 'Regarding your recent appointment request',
    greeting: 'Hello{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Thank you for your interest in scheduling an appointment with us. Unfortunately, we are unable to accommodate your request at the requested time.',
    detailsTitle: 'Original Request',
    service: 'Service:',
    requestedDate: 'Requested Date:',
    requestedTime: 'Requested Time:',
    reference: 'Reference:',
    reasonTitle: 'Reason',
    helpTitle: "We'd Still Love to Help",
    helpBody: "We apologize for any inconvenience. We encourage you to submit a new request for an alternative date and time that works better with our availability.",
    requestButton: 'Request Another Time',
    contactMsg: "If you have any questions or would like assistance finding an available time slot, please don't hesitate to contact us at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}. Our team is here to help you find a time that works.",
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    // text-only
    textHeader: 'Appointment Request Update',
    textDetailsHeader: 'ORIGINAL REQUEST',
    textService: 'Service',
    textRequestedDate: 'Requested Date',
    textRequestedTime: 'Requested Time',
    textReference: 'Reference',
    textReasonHeader: 'REASON',
    textHelpHeader: "WE'D STILL LOVE TO HELP",
    textRequestButton: 'Request Another Time',
  },
  fr: {
    headerLabel: 'Mise \u00e0 jour de la demande',
    headerSub: 'Concernant votre demande de rendez-vous r\u00e9cente',
    greeting: 'Bonjour{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: "Merci de votre int\u00e9r\u00eat pour la prise de rendez-vous avec nous. Malheureusement, nous ne sommes pas en mesure de r\u00e9pondre \u00e0 votre demande \u00e0 l'heure demand\u00e9e.",
    detailsTitle: 'Demande initiale',
    service: 'Service :',
    requestedDate: 'Date demand\u00e9e :',
    requestedTime: 'Heure demand\u00e9e :',
    reference: 'R\u00e9f\u00e9rence :',
    reasonTitle: 'Raison',
    helpTitle: 'Nous serions ravis de vous aider',
    helpBody: "Nous nous excusons pour tout d\u00e9sagr\u00e9ment. Nous vous encourageons \u00e0 soumettre une nouvelle demande pour une date et une heure alternatives qui correspondent mieux \u00e0 notre disponibilit\u00e9.",
    requestButton: 'Demander un autre cr\u00e9neau',
    contactMsg: "Si vous avez des questions ou si vous souhaitez de l'aide pour trouver un cr\u00e9neau disponible, n'h\u00e9sitez pas \u00e0 nous contacter \u00e0 {{contactEmail}}{{#if contactPhone}} ou \u00e0 appeler le {{contactPhone}}{{/if}}. Notre \u00e9quipe est l\u00e0 pour vous aider \u00e0 trouver un horaire qui vous convient.",
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Mise \u00e0 jour de la demande de rendez-vous',
    textDetailsHeader: 'DEMANDE INITIALE',
    textService: 'Service',
    textRequestedDate: 'Date demand\u00e9e',
    textRequestedTime: 'Heure demand\u00e9e',
    textReference: 'R\u00e9f\u00e9rence',
    textReasonHeader: 'RAISON',
    textHelpHeader: 'NOUS SERIONS RAVIS DE VOUS AIDER',
    textRequestButton: 'Demander un autre cr\u00e9neau',
  },
  es: {
    headerLabel: 'Actualizaci\u00f3n de solicitud',
    headerSub: 'Respecto a su solicitud de cita reciente',
    greeting: 'Hola{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Gracias por su inter\u00e9s en programar una cita con nosotros. Lamentablemente, no podemos acomodar su solicitud en el horario solicitado.',
    detailsTitle: 'Solicitud original',
    service: 'Servicio:',
    requestedDate: 'Fecha solicitada:',
    requestedTime: 'Hora solicitada:',
    reference: 'Referencia:',
    reasonTitle: 'Motivo',
    helpTitle: 'Nos encantar\u00eda ayudarle',
    helpBody: 'Pedimos disculpas por cualquier inconveniente. Le animamos a enviar una nueva solicitud para una fecha y hora alternativa que funcione mejor con nuestra disponibilidad.',
    requestButton: 'Solicitar otro horario',
    contactMsg: 'Si tiene alguna pregunta o desea ayuda para encontrar un horario disponible, no dude en contactarnos en {{contactEmail}}{{#if contactPhone}} o llamar al {{contactPhone}}{{/if}}. Nuestro equipo est\u00e1 aqu\u00ed para ayudarle a encontrar un horario que le funcione.',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Actualizaci\u00f3n de solicitud de cita',
    textDetailsHeader: 'SOLICITUD ORIGINAL',
    textService: 'Servicio',
    textRequestedDate: 'Fecha solicitada',
    textRequestedTime: 'Hora solicitada',
    textReference: 'Referencia',
    textReasonHeader: 'MOTIVO',
    textHelpHeader: 'NOS ENCANTAR\u00cdA AYUDARLE',
    textRequestButton: 'Solicitar otro horario',
  },
  de: {
    headerLabel: 'Aktualisierung Ihrer Terminanfrage',
    headerSub: 'Bez\u00fcglich Ihrer aktuellen Terminanfrage',
    greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Vielen Dank f\u00fcr Ihr Interesse, einen Termin mit uns zu vereinbaren. Leider k\u00f6nnen wir Ihrer Anfrage zum gew\u00fcnschten Zeitpunkt nicht nachkommen.',
    detailsTitle: 'Urspr\u00fcngliche Anfrage',
    service: 'Service:',
    requestedDate: 'Gew\u00fcnschtes Datum:',
    requestedTime: 'Gew\u00fcnschte Zeit:',
    reference: 'Referenz:',
    reasonTitle: 'Grund',
    helpTitle: 'Wir helfen Ihnen gerne weiter',
    helpBody: 'Wir entschuldigen uns f\u00fcr etwaige Unannehmlichkeiten. Wir ermutigen Sie, eine neue Anfrage f\u00fcr ein alternatives Datum und eine alternative Zeit einzureichen, die besser zu unserer Verf\u00fcgbarkeit passen.',
    requestButton: 'Andere Zeit anfragen',
    contactMsg: 'Wenn Sie Fragen haben oder Hilfe bei der Suche nach einem verf\u00fcgbaren Zeitfenster ben\u00f6tigen, z\u00f6gern Sie bitte nicht, uns unter {{contactEmail}}{{#if contactPhone}} zu kontaktieren oder {{contactPhone}} anzurufen{{/if}}. Unser Team hilft Ihnen gerne, einen passenden Zeitpunkt zu finden.',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Aktualisierung Ihrer Terminanfrage',
    textDetailsHeader: 'URSPR\u00dcNGLICHE ANFRAGE',
    textService: 'Service',
    textRequestedDate: 'Gew\u00fcnschtes Datum',
    textRequestedTime: 'Gew\u00fcnschte Zeit',
    textReference: 'Referenz',
    textReasonHeader: 'GRUND',
    textHelpHeader: 'WIR HELFEN IHNEN GERNE WEITER',
    textRequestButton: 'Andere Zeit anfragen',
  },
  nl: {
    headerLabel: 'Update afspraakverzoek',
    headerSub: 'Betreffende uw recente afspraakverzoek',
    greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Bedankt voor uw interesse om een afspraak met ons te maken. Helaas kunnen we uw verzoek niet op de gevraagde tijd accommoderen.',
    detailsTitle: 'Oorspronkelijk verzoek',
    service: 'Dienst:',
    requestedDate: 'Gevraagde datum:',
    requestedTime: 'Gevraagde tijd:',
    reference: 'Referentie:',
    reasonTitle: 'Reden',
    helpTitle: 'We helpen u graag verder',
    helpBody: 'Onze excuses voor het ongemak. We moedigen u aan om een nieuw verzoek in te dienen voor een alternatieve datum en tijd die beter past bij onze beschikbaarheid.',
    requestButton: 'Andere tijd aanvragen',
    contactMsg: 'Als u vragen heeft of hulp nodig heeft bij het vinden van een beschikbaar tijdslot, aarzel dan niet om contact met ons op te nemen via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}. Ons team helpt u graag bij het vinden van een geschikte tijd.',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Update afspraakverzoek',
    textDetailsHeader: 'OORSPRONKELIJK VERZOEK',
    textService: 'Dienst',
    textRequestedDate: 'Gevraagde datum',
    textRequestedTime: 'Gevraagde tijd',
    textReference: 'Referentie',
    textReasonHeader: 'REDEN',
    textHelpHeader: 'WE HELPEN U GRAAG VERDER',
    textRequestButton: 'Andere tijd aanvragen',
  },
  it: {
    headerLabel: 'Aggiornamento richiesta',
    headerSub: 'Riguardo alla tua recente richiesta di appuntamento',
    greeting: 'Ciao{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: "Grazie per il tuo interesse nel fissare un appuntamento con noi. Sfortunatamente, non siamo in grado di accogliere la tua richiesta all'orario richiesto.",
    detailsTitle: 'Richiesta originale',
    service: 'Servizio:',
    requestedDate: 'Data richiesta:',
    requestedTime: 'Ora richiesta:',
    reference: 'Riferimento:',
    reasonTitle: 'Motivo',
    helpTitle: 'Saremo felici di aiutarti',
    helpBody: "Ci scusiamo per l'inconveniente. Ti invitiamo a inviare una nuova richiesta per una data e un'ora alternative che si adattino meglio alla nostra disponibilit\u00e0.",
    requestButton: 'Richiedi altro orario',
    contactMsg: "Se hai domande o desideri assistenza per trovare una fascia oraria disponibile, non esitare a contattarci all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}. Il nostro team \u00e8 qui per aiutarti a trovare un orario che funzioni per te.",
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Aggiornamento richiesta di appuntamento',
    textDetailsHeader: 'RICHIESTA ORIGINALE',
    textService: 'Servizio',
    textRequestedDate: 'Data richiesta',
    textRequestedTime: 'Ora richiesta',
    textReference: 'Riferimento',
    textReasonHeader: 'MOTIVO',
    textHelpHeader: 'SAREMO FELICI DI AIUTARTI',
    textRequestButton: 'Richiedi altro orario',
  },
  pl: {
    headerLabel: 'Aktualizacja wniosku o wizyt\u0119',
    headerSub: 'Wa\u017cne informacje o Twoim wniosku',
    greeting: 'Witaj{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Dzi\u0119kujemy za zainteresowanie um\u00f3wieniem wizyty u nas. Niestety, nie mo\u017cemy zrealizowa\u0107 Twojego wniosku w \u017c\u0105danym terminie.',
    detailsTitle: 'Oryginalny wniosek',
    service: 'Us\u0142uga:',
    requestedDate: '\u017b\u0105dana data:',
    requestedTime: '\u017b\u0105dana godzina:',
    reference: 'Referencja:',
    reasonTitle: 'Pow\u00f3d',
    helpTitle: 'Ch\u0119tnie pomo\u017cemy',
    helpBody: 'Przepraszamy za niedogodno\u015bci. Zach\u0119camy do z\u0142o\u017cenia nowego wniosku na inny termin.',
    requestButton: 'Zg\u0142o\u015b inny termin',
    contactMsg: 'Je\u015bli masz pytania lub potrzebujesz pomocy w znalezieniu dost\u0119pnego terminu, skontaktuj si\u0119 z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwo\u0144 pod {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA',
    textHeader: 'Aktualizacja wniosku o wizyt\u0119',
    textDetailsHeader: 'ORYGINALNY WNIOSEK',
    textService: 'Us\u0142uga',
    textRequestedDate: '\u017b\u0105dana data',
    textRequestedTime: '\u017b\u0105dana godzina',
    textReference: 'Referencja',
    textReasonHeader: 'POW\u00d3D',
    textHelpHeader: 'CH\u0118TNIE POMO\u017bEMY',
    textRequestButton: 'Zg\u0142o\u015b inny termin',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin:24px 0;padding:20px;border-left:4px solid #64748b;background:${INFO_BOX_BG};border-radius:6px;">
                  <div style="font-weight:600;color:#1e293b;margin-bottom:16px;font-size:16px;">${c.detailsTitle}</div>
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
                      <td style="padding:8px 0;font-weight:600;color:#475467;">${c.reference}</td>
                      <td style="padding:8px 0;">{{referenceNumber}}</td>
                    </tr>
                  </table>
                </div>
                {{#if declineReason}}
                <div style="margin:24px 0;padding:16px 20px;border-radius:6px;background:#fef2f2;border-left:4px solid #ef4444;">
                  <div style="font-weight:600;color:#991b1b;margin-bottom:8px;font-size:15px;">${c.reasonTitle}</div>
                  <div style="color:#7f1d1d;font-size:14px;">{{declineReason}}</div>
                </div>
                {{/if}}
                <div style="margin:24px 0;padding:20px;border-radius:6px;background:#eff6ff;border-left:4px solid #3b82f6;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:12px;font-size:16px;">${c.helpTitle}</div>
                  <div style="color:#1e3a8a;font-size:14px;margin-bottom:16px;">${c.helpBody}</div>
                  {{#if requestNewAppointmentLink}}
                  <a href="{{requestNewAppointmentLink}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px;">${c.requestButton}</a>
                  {{/if}}
                </div>
                <p style="margin:0 0 16px 0;font-size:15px;color:#475569;line-height:1.5;">${c.contactMsg}</p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.greeting}

${c.intro}

${c.textDetailsHeader}:
${c.textService}: {{serviceName}}
${c.textRequestedDate}: {{requestedDate}}
${c.textRequestedTime}: {{requestedTime}}
${c.textReference}: {{referenceNumber}}

{{#if declineReason}}
${c.textReasonHeader}:
{{declineReason}}
{{/if}}

${c.textHelpHeader}
${c.helpBody}

{{#if requestNewAppointmentLink}}
${c.textRequestButton}: {{requestNewAppointmentLink}}
{{/if}}

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
