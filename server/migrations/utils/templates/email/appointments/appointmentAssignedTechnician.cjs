/**
 * Source-of-truth: appointment-assigned-technician email template.
 *
 * Sent to the assigned technician when an appointment request is approved.
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 *
 * Template variables:
 *   {{technicianName}}   - Name of the assigned technician
 *   {{serviceName}}      - Name of the service
 *   {{appointmentDate}}  - Formatted date of the appointment
 *   {{appointmentTime}}  - Formatted time of the appointment
 *   {{duration}}         - Duration in minutes
 *   {{clientName}}       - Client/requester name (optional)
 *   {{description}}      - Appointment notes (optional)
 *   {{calendarLink}}     - Link to download ICS file (optional)
 *   {{contactEmail}}     - Support contact email
 *   {{contactPhone}}     - Support contact phone (optional)
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'appointment-assigned-technician';
const SUBTYPE_NAME = 'appointment-assigned-technician';

const SUBJECTS = {
  en: 'Appointment Assigned - {{serviceName}} on {{appointmentDate}}',
  fr: 'Rendez-vous assign\u00e9 - {{serviceName}} le {{appointmentDate}}',
  es: 'Cita asignada - {{serviceName}} el {{appointmentDate}}',
  de: 'Termin zugewiesen - {{serviceName}} am {{appointmentDate}}',
  nl: 'Afspraak toegewezen - {{serviceName}} op {{appointmentDate}}',
  it: 'Appuntamento assegnato - {{serviceName}} il {{appointmentDate}}',
  pl: 'Wizyta przypisana - {{serviceName}} dnia {{appointmentDate}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Appointment Assigned',
    headerSub: 'You have a new appointment',
    greeting: 'Hello {{technicianName}},',
    intro: 'You have been assigned a new appointment. Please review the details below.',
    appointmentTitle: 'Appointment Details',
    service: 'Service',
    date: 'Date',
    time: 'Time',
    duration: 'Duration',
    durationUnit: 'minutes',
    clientTitle: 'Client',
    notesTitle: 'Notes',
    calendarButton: 'Add to Calendar',
    contactMsg: 'If you have questions, please contact {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Appointment Assigned',
    textAppointmentHeader: 'APPOINTMENT DETAILS',
    textService: 'Service',
    textDate: 'Date',
    textTime: 'Time',
    textDuration: 'Duration',
    textDurationUnit: 'minutes',
    textClient: 'Client',
    textNotes: 'Notes',
    textCalendar: 'Add to Calendar',
  },
  fr: {
    headerLabel: 'Rendez-vous assign\u00e9',
    headerSub: 'Vous avez un nouveau rendez-vous',
    greeting: 'Bonjour {{technicianName}},',
    intro: 'Un nouveau rendez-vous vous a \u00e9t\u00e9 assign\u00e9. Veuillez consulter les d\u00e9tails ci-dessous.',
    appointmentTitle: 'D\u00e9tails du rendez-vous',
    service: 'Service',
    date: 'Date',
    time: 'Heure',
    duration: 'Dur\u00e9e',
    durationUnit: 'minutes',
    clientTitle: 'Client',
    notesTitle: 'Notes',
    calendarButton: 'Ajouter au calendrier',
    contactMsg: 'Si vous avez des questions, veuillez contacter {{contactEmail}}{{#if contactPhone}} ou appeler le {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Rendez-vous assign\u00e9',
    textAppointmentHeader: 'D\u00c9TAILS DU RENDEZ-VOUS',
    textService: 'Service',
    textDate: 'Date',
    textTime: 'Heure',
    textDuration: 'Dur\u00e9e',
    textDurationUnit: 'minutes',
    textClient: 'Client',
    textNotes: 'Notes',
    textCalendar: 'Ajouter au calendrier',
  },
  es: {
    headerLabel: 'Cita asignada',
    headerSub: 'Tiene una nueva cita',
    greeting: 'Hola {{technicianName}},',
    intro: 'Se le ha asignado una nueva cita. Por favor revise los detalles a continuaci\u00f3n.',
    appointmentTitle: 'Detalles de la cita',
    service: 'Servicio',
    date: 'Fecha',
    time: 'Hora',
    duration: 'Duraci\u00f3n',
    durationUnit: 'minutos',
    clientTitle: 'Cliente',
    notesTitle: 'Notas',
    calendarButton: 'Agregar al calendario',
    contactMsg: 'Si tiene preguntas, contacte a {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Cita asignada',
    textAppointmentHeader: 'DETALLES DE LA CITA',
    textService: 'Servicio',
    textDate: 'Fecha',
    textTime: 'Hora',
    textDuration: 'Duraci\u00f3n',
    textDurationUnit: 'minutos',
    textClient: 'Cliente',
    textNotes: 'Notas',
    textCalendar: 'Agregar al calendario',
  },
  de: {
    headerLabel: 'Termin zugewiesen',
    headerSub: 'Sie haben einen neuen Termin',
    greeting: 'Hallo {{technicianName}},',
    intro: 'Ihnen wurde ein neuer Termin zugewiesen. Bitte \u00fcberpr\u00fcfen Sie die Details unten.',
    appointmentTitle: 'Termindetails',
    service: 'Service',
    date: 'Datum',
    time: 'Zeit',
    duration: 'Dauer',
    durationUnit: 'Minuten',
    clientTitle: 'Kunde',
    notesTitle: 'Anmerkungen',
    calendarButton: 'Zum Kalender hinzuf\u00fcgen',
    contactMsg: 'Bei Fragen kontaktieren Sie bitte {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Termin zugewiesen',
    textAppointmentHeader: 'TERMINDETAILS',
    textService: 'Service',
    textDate: 'Datum',
    textTime: 'Zeit',
    textDuration: 'Dauer',
    textDurationUnit: 'Minuten',
    textClient: 'Kunde',
    textNotes: 'Anmerkungen',
    textCalendar: 'Zum Kalender hinzuf\u00fcgen',
  },
  nl: {
    headerLabel: 'Afspraak toegewezen',
    headerSub: 'U heeft een nieuwe afspraak',
    greeting: 'Hallo {{technicianName}},',
    intro: 'Er is een nieuwe afspraak aan u toegewezen. Bekijk de details hieronder.',
    appointmentTitle: 'Afspraakdetails',
    service: 'Dienst',
    date: 'Datum',
    time: 'Tijd',
    duration: 'Duur',
    durationUnit: 'minuten',
    clientTitle: 'Klant',
    notesTitle: 'Opmerkingen',
    calendarButton: 'Toevoegen aan agenda',
    contactMsg: 'Als u vragen heeft, neem dan contact op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Afspraak toegewezen',
    textAppointmentHeader: 'AFSPRAAKDETAILS',
    textService: 'Dienst',
    textDate: 'Datum',
    textTime: 'Tijd',
    textDuration: 'Duur',
    textDurationUnit: 'minuten',
    textClient: 'Klant',
    textNotes: 'Opmerkingen',
    textCalendar: 'Toevoegen aan agenda',
  },
  it: {
    headerLabel: 'Appuntamento assegnato',
    headerSub: 'Hai un nuovo appuntamento',
    greeting: 'Ciao {{technicianName}},',
    intro: 'Ti \u00e8 stato assegnato un nuovo appuntamento. Controlla i dettagli qui sotto.',
    appointmentTitle: "Dettagli dell'appuntamento",
    service: 'Servizio',
    date: 'Data',
    time: 'Ora',
    duration: 'Durata',
    durationUnit: 'minuti',
    clientTitle: 'Cliente',
    notesTitle: 'Note',
    calendarButton: 'Aggiungi al calendario',
    contactMsg: 'Se hai domande, contatta {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Appuntamento assegnato',
    textAppointmentHeader: "DETTAGLI DELL'APPUNTAMENTO",
    textService: 'Servizio',
    textDate: 'Data',
    textTime: 'Ora',
    textDuration: 'Durata',
    textDurationUnit: 'minuti',
    textClient: 'Cliente',
    textNotes: 'Note',
    textCalendar: 'Aggiungi al calendario',
  },
  pl: {
    headerLabel: 'Wizyta przypisana',
    headerSub: 'Masz now\u0105 wizyt\u0119',
    greeting: 'Witaj {{technicianName}},',
    intro: 'Przypisano Ci now\u0105 wizyt\u0119. Sprawd\u017a szczeg\u00f3\u0142y poni\u017cej.',
    appointmentTitle: 'Szczeg\u00f3\u0142y wizyty',
    service: 'Us\u0142uga',
    date: 'Data',
    time: 'Godzina',
    duration: 'Czas trwania',
    durationUnit: 'minut',
    clientTitle: 'Klient',
    notesTitle: 'Uwagi',
    calendarButton: 'Dodaj do kalendarza',
    contactMsg: 'Je\u015bli masz pytania, skontaktuj si\u0119 pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwo\u0144 pod {{contactPhone}}{{/if}}.',
    footer: 'Powered by Alga PSA',
    textHeader: 'Wizyta przypisana',
    textAppointmentHeader: 'SZCZEG\u00d3\u0141Y WIZYTY',
    textService: 'Us\u0142uga',
    textDate: 'Data',
    textTime: 'Godzina',
    textDuration: 'Czas trwania',
    textDurationUnit: 'minut',
    textClient: 'Klient',
    textNotes: 'Uwagi',
    textCalendar: 'Dodaj do kalendarza',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin:24px 0;padding:24px;border-radius:8px;background:linear-gradient(135deg,${INFO_BOX_BG} 0%,#ede9fe 100%);border:2px solid ${BRAND_PRIMARY};text-align:center;">
                  <div style="font-weight:600;color:${BRAND_DARK};font-size:18px;margin-bottom:20px;">${c.appointmentTitle}</div>
                  <div style="margin:12px 0;">
                    <div style="color:${BRAND_DARK};font-size:14px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:4px;">${c.service}</div>
                    <div style="color:#1e293b;font-size:18px;font-weight:600;">{{serviceName}}</div>
                  </div>
                  <div style="margin:12px 0;">
                    <div style="color:${BRAND_DARK};font-size:14px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:4px;">${c.date}</div>
                    <div style="color:#1e293b;font-size:18px;font-weight:600;">{{appointmentDate}}</div>
                  </div>
                  <div style="margin:12px 0;">
                    <div style="color:${BRAND_DARK};font-size:14px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:4px;">${c.time}</div>
                    <div style="color:#1e293b;font-size:18px;font-weight:600;">{{appointmentTime}}</div>
                  </div>
                  <div style="margin:12px 0;">
                    <div style="color:${BRAND_DARK};font-size:14px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:4px;">${c.duration}</div>
                    <div style="color:#1e293b;font-size:18px;font-weight:600;">{{duration}} ${c.durationUnit}</div>
                  </div>
                </div>
                {{#if clientName}}
                <div style="margin:24px 0;padding:20px;border-left:4px solid ${BRAND_PRIMARY};background:${INFO_BOX_BG};border-radius:6px;">
                  <div style="font-weight:600;color:#1e293b;margin-bottom:8px;font-size:16px;">${c.clientTitle}</div>
                  <div style="color:#475569;font-size:15px;"><strong>{{clientName}}</strong></div>
                </div>
                {{/if}}
                {{#if description}}
                <div style="margin:24px 0;padding:20px;border-left:4px solid #94a3b8;background:#f8fafc;border-radius:6px;">
                  <div style="font-weight:600;color:#1e293b;margin-bottom:8px;font-size:16px;">${c.notesTitle}</div>
                  <div style="color:#475569;font-size:15px;">{{description}}</div>
                </div>
                {{/if}}
                {{#if calendarLink}}
                <div style="text-align:center;margin:24px 0;">
                  <a href="{{calendarLink}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:16px;">${c.calendarButton}</a>
                </div>
                {{/if}}
                <p style="margin:0 0 16px 0;font-size:15px;color:#475569;line-height:1.5;">${c.contactMsg}</p>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.greeting}

${c.intro}

${c.textAppointmentHeader}:
${c.textService}: {{serviceName}}
${c.textDate}: {{appointmentDate}}
${c.textTime}: {{appointmentTime}}
${c.textDuration}: {{duration}} ${c.textDurationUnit}

{{#if clientName}}
${c.textClient}: {{clientName}}
{{/if}}

{{#if description}}
${c.textNotes}: {{description}}
{{/if}}

{{#if calendarLink}}
${c.textCalendar}: {{calendarLink}}
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
