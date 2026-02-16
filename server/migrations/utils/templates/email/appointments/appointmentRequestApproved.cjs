/**
 * Source-of-truth: appointment-request-approved email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'appointment-request-approved';
const SUBTYPE_NAME = 'appointment-request-approved';

const SUBJECTS = {
  en: 'Appointment Confirmed - {{serviceName}} on {{appointmentDate}}',
  fr: 'Rendez-vous confirm\u00e9 - {{serviceName}} le {{appointmentDate}}',
  es: 'Cita confirmada - {{serviceName}} el {{appointmentDate}}',
  de: 'Termin best\u00e4tigt - {{serviceName}} am {{appointmentDate}}',
  nl: 'Afspraak bevestigd - {{serviceName}} op {{appointmentDate}}',
  it: 'Appuntamento confermato - {{serviceName}} il {{appointmentDate}}',
  pl: 'Wizyta potwierdzona - {{serviceName}} dnia {{appointmentDate}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Appointment Confirmed',
    headerSub: 'Your appointment has been approved',
    greeting: 'Hello{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Great news! Your appointment request has been approved and confirmed. We look forward to serving you.',
    appointmentTitle: 'Your Appointment',
    service: 'Service',
    date: 'Date',
    time: 'Time',
    duration: 'Duration',
    durationUnit: 'minutes',
    technicianTitle: 'Assigned Technician',
    technicianEmail: 'Email:',
    technicianPhone: 'Phone:',
    calendarButton: 'Add to Calendar',
    cancellationTitle: 'Cancellation Policy',
    rescheduleMsg: 'If you need to reschedule or cancel this appointment, please contact us at least {{minimumNoticeHours}} hours in advance at {{contactEmail}}{{#if contactPhone}} or call {{contactPhone}}{{/if}}.',
    reminderMsg: "We'll send you a reminder before your appointment. See you soon!",
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    // text-only
    textHeader: 'Appointment Confirmed',
    textAppointmentHeader: 'YOUR APPOINTMENT',
    textService: 'Service',
    textDate: 'Date',
    textTime: 'Time',
    textDuration: 'Duration',
    textDurationUnit: 'minutes',
    textTechHeader: 'ASSIGNED TECHNICIAN',
    textTechEmail: 'Email',
    textTechPhone: 'Phone',
    textCalendar: 'Add to Calendar',
    textCancelHeader: 'CANCELLATION POLICY',
  },
  fr: {
    headerLabel: 'Rendez-vous confirm\u00e9',
    headerSub: 'Votre rendez-vous a \u00e9t\u00e9 approuv\u00e9',
    greeting: 'Bonjour{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Excellente nouvelle ! Votre demande de rendez-vous a \u00e9t\u00e9 approuv\u00e9e et confirm\u00e9e. Nous sommes impatients de vous servir.',
    appointmentTitle: 'Votre rendez-vous',
    service: 'Service',
    date: 'Date',
    time: 'Heure',
    duration: 'Dur\u00e9e',
    durationUnit: 'minutes',
    technicianTitle: 'Technicien assign\u00e9',
    technicianEmail: 'E-mail :',
    technicianPhone: 'T\u00e9l\u00e9phone :',
    calendarButton: 'Ajouter au calendrier',
    cancellationTitle: "Politique d'annulation",
    rescheduleMsg: "Si vous devez reporter ou annuler ce rendez-vous, veuillez nous contacter au moins {{minimumNoticeHours}} heures \u00e0 l'avance \u00e0 {{contactEmail}}{{#if contactPhone}} ou appeler le {{contactPhone}}{{/if}}.",
    reminderMsg: 'Nous vous enverrons un rappel avant votre rendez-vous. \u00c0 bient\u00f4t !',
    footer: 'Powered by Alga PSA &middot; Maintenir les \u00e9quipes align\u00e9es',
    textHeader: 'Rendez-vous confirm\u00e9',
    textAppointmentHeader: 'VOTRE RENDEZ-VOUS',
    textService: 'Service',
    textDate: 'Date',
    textTime: 'Heure',
    textDuration: 'Dur\u00e9e',
    textDurationUnit: 'minutes',
    textTechHeader: 'TECHNICIEN ASSIGN\u00c9',
    textTechEmail: 'E-mail',
    textTechPhone: 'T\u00e9l\u00e9phone',
    textCalendar: 'Ajouter au calendrier',
    textCancelHeader: "POLITIQUE D'ANNULATION",
  },
  es: {
    headerLabel: 'Cita confirmada',
    headerSub: 'Su cita ha sido aprobada',
    greeting: 'Hola{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: '\u00a1Excelentes noticias! Su solicitud de cita ha sido aprobada y confirmada. Esperamos poder servirle.',
    appointmentTitle: 'Su cita',
    service: 'Servicio',
    date: 'Fecha',
    time: 'Hora',
    duration: 'Duraci\u00f3n',
    durationUnit: 'minutos',
    technicianTitle: 'T\u00e9cnico asignado',
    technicianEmail: 'Correo:',
    technicianPhone: 'Tel\u00e9fono:',
    calendarButton: 'Agregar al calendario',
    cancellationTitle: 'Pol\u00edtica de cancelaci\u00f3n',
    rescheduleMsg: 'Si necesita reprogramar o cancelar esta cita, por favor cont\u00e1ctenos con al menos {{minimumNoticeHours}} horas de anticipaci\u00f3n en {{contactEmail}}{{#if contactPhone}} o llame al {{contactPhone}}{{/if}}.',
    reminderMsg: 'Le enviaremos un recordatorio antes de su cita. \u00a1Hasta pronto!',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Cita confirmada',
    textAppointmentHeader: 'SU CITA',
    textService: 'Servicio',
    textDate: 'Fecha',
    textTime: 'Hora',
    textDuration: 'Duraci\u00f3n',
    textDurationUnit: 'minutos',
    textTechHeader: 'T\u00c9CNICO ASIGNADO',
    textTechEmail: 'Correo',
    textTechPhone: 'Tel\u00e9fono',
    textCalendar: 'Agregar al calendario',
    textCancelHeader: 'POL\u00cdTICA DE CANCELACI\u00d3N',
  },
  de: {
    headerLabel: 'Termin best\u00e4tigt',
    headerSub: 'Ihr Termin wurde genehmigt',
    greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Gro\u00dfartige Neuigkeiten! Ihre Terminanfrage wurde genehmigt und best\u00e4tigt. Wir freuen uns darauf, Sie zu bedienen.',
    appointmentTitle: 'Ihr Termin',
    service: 'Service',
    date: 'Datum',
    time: 'Zeit',
    duration: 'Dauer',
    durationUnit: 'Minuten',
    technicianTitle: 'Zugewiesener Techniker',
    technicianEmail: 'E-Mail:',
    technicianPhone: 'Telefon:',
    calendarButton: 'Zum Kalender hinzuf\u00fcgen',
    cancellationTitle: 'Stornierungsbedingungen',
    rescheduleMsg: 'Wenn Sie diesen Termin verschieben oder stornieren m\u00fcssen, kontaktieren Sie uns bitte mindestens {{minimumNoticeHours}} Stunden im Voraus unter {{contactEmail}}{{#if contactPhone}} oder rufen Sie {{contactPhone}} an{{/if}}.',
    reminderMsg: 'Wir senden Ihnen vor Ihrem Termin eine Erinnerung. Bis bald!',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Termin best\u00e4tigt',
    textAppointmentHeader: 'IHR TERMIN',
    textService: 'Service',
    textDate: 'Datum',
    textTime: 'Zeit',
    textDuration: 'Dauer',
    textDurationUnit: 'Minuten',
    textTechHeader: 'ZUGEWIESENER TECHNIKER',
    textTechEmail: 'E-Mail',
    textTechPhone: 'Telefon',
    textCalendar: 'Zum Kalender hinzuf\u00fcgen',
    textCancelHeader: 'STORNIERUNGSBEDINGUNGEN',
  },
  nl: {
    headerLabel: 'Afspraak bevestigd',
    headerSub: 'Uw afspraak is goedgekeurd',
    greeting: 'Hallo{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: 'Geweldig nieuws! Uw afspraakverzoek is goedgekeurd en bevestigd. We kijken ernaar uit u te bedienen.',
    appointmentTitle: 'Uw afspraak',
    service: 'Dienst',
    date: 'Datum',
    time: 'Tijd',
    duration: 'Duur',
    durationUnit: 'minuten',
    technicianTitle: 'Toegewezen technicus',
    technicianEmail: 'E-mail:',
    technicianPhone: 'Telefoon:',
    calendarButton: 'Toevoegen aan agenda',
    cancellationTitle: 'Annuleringsbeleid',
    rescheduleMsg: 'Als u deze afspraak moet verzetten of annuleren, neem dan minimaal {{minimumNoticeHours}} uur van tevoren contact met ons op via {{contactEmail}}{{#if contactPhone}} of bel {{contactPhone}}{{/if}}.',
    reminderMsg: 'We sturen u een herinnering voordat uw afspraak plaatsvindt. Tot snel!',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Afspraak bevestigd',
    textAppointmentHeader: 'UW AFSPRAAK',
    textService: 'Dienst',
    textDate: 'Datum',
    textTime: 'Tijd',
    textDuration: 'Duur',
    textDurationUnit: 'minuten',
    textTechHeader: 'TOEGEWEZEN TECHNICUS',
    textTechEmail: 'E-mail',
    textTechPhone: 'Telefoon',
    textCalendar: 'Toevoegen aan agenda',
    textCancelHeader: 'ANNULERINGSBELEID',
  },
  it: {
    headerLabel: 'Appuntamento confermato',
    headerSub: 'Il tuo appuntamento \u00e8 stato approvato',
    greeting: 'Ciao{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: "Ottime notizie! La tua richiesta di appuntamento \u00e8 stata approvata e confermata. Non vediamo l'ora di servirti.",
    appointmentTitle: 'Il tuo appuntamento',
    service: 'Servizio',
    date: 'Data',
    time: 'Ora',
    duration: 'Durata',
    durationUnit: 'minuti',
    technicianTitle: 'Tecnico assegnato',
    technicianEmail: 'Email:',
    technicianPhone: 'Telefono:',
    calendarButton: 'Aggiungi al calendario',
    cancellationTitle: 'Politica di cancellazione',
    rescheduleMsg: "Se devi riprogrammare o annullare questo appuntamento, ti preghiamo di contattarci con almeno {{minimumNoticeHours}} ore di anticipo all'indirizzo {{contactEmail}}{{#if contactPhone}} o chiama il {{contactPhone}}{{/if}}.",
    reminderMsg: 'Ti invieremo un promemoria prima del tuo appuntamento. A presto!',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Appuntamento confermato',
    textAppointmentHeader: 'IL TUO APPUNTAMENTO',
    textService: 'Servizio',
    textDate: 'Data',
    textTime: 'Ora',
    textDuration: 'Durata',
    textDurationUnit: 'minuti',
    textTechHeader: 'TECNICO ASSEGNATO',
    textTechEmail: 'Email',
    textTechPhone: 'Telefono',
    textCalendar: 'Aggiungi al calendario',
    textCancelHeader: 'POLITICA DI CANCELLAZIONE',
  },
  pl: {
    headerLabel: 'Wizyta potwierdzona',
    headerSub: 'Tw\u00f3j wniosek o wizyt\u0119 zosta\u0142 zatwierdzony',
    greeting: 'Witaj{{#if requesterName}} {{requesterName}}{{/if}},',
    intro: '\u015awietna wiadomo\u015b\u0107! Tw\u00f3j wniosek o wizyt\u0119 zosta\u0142 zatwierdzony i zaplanowany.',
    appointmentTitle: 'Szczeg\u00f3\u0142y wizyty',
    service: 'Us\u0142uga',
    date: 'Data',
    time: 'Godzina',
    duration: 'Czas trwania',
    durationUnit: 'minut',
    technicianTitle: 'Tw\u00f3j przypisany technik',
    technicianEmail: 'Email:',
    technicianPhone: 'Telefon:',
    calendarButton: 'Dodaj do kalendarza',
    cancellationTitle: 'Polityka anulowania',
    rescheduleMsg: 'Je\u015bli potrzebujesz prze\u0142o\u017cy\u0107 lub anulowa\u0107 wizyt\u0119, skontaktuj si\u0119 z nami pod adresem {{contactEmail}}{{#if contactPhone}} lub zadzwo\u0144 pod {{contactPhone}}{{/if}}.',
    reminderMsg: 'Wy\u015blemy Ci przypomnienie przed wizyt\u0105. Do zobaczenia!',
    footer: 'Powered by Alga PSA',
    textHeader: 'Wizyta potwierdzona',
    textAppointmentHeader: 'SZCZEG\u00d3\u0141Y WIZYTY',
    textService: 'Us\u0142uga',
    textDate: 'Data',
    textTime: 'Godzina',
    textDuration: 'Czas trwania',
    textDurationUnit: 'minut',
    textTechHeader: 'TW\u00d3J PRZYPISANY TECHNIK',
    textTechEmail: 'Email',
    textTechPhone: 'Telefon',
    textCalendar: 'Dodaj do kalendarza',
    textCancelHeader: 'POLITYKA ANULOWANIA',
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
                {{#if technicianName}}
                <div style="margin:24px 0;padding:20px;border-left:4px solid ${BRAND_PRIMARY};background:${INFO_BOX_BG};border-radius:6px;">
                  <div style="font-weight:600;color:#1e293b;margin-bottom:12px;font-size:16px;">${c.technicianTitle}</div>
                  <div style="color:#475569;font-size:15px;">
                    <strong>{{technicianName}}</strong>{{#if technicianEmail}}<br>${c.technicianEmail} {{technicianEmail}}{{/if}}{{#if technicianPhone}}<br>${c.technicianPhone} {{technicianPhone}}{{/if}}
                  </div>
                </div>
                {{/if}}
                {{#if calendarLink}}
                <div style="text-align:center;margin:24px 0;">
                  <a href="{{calendarLink}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:16px;">${c.calendarButton}</a>
                </div>
                {{/if}}
                {{#if cancellationPolicy}}
                <div style="margin:24px 0;padding:16px 20px;border-radius:6px;background:#fef3c7;border-left:4px solid #f59e0b;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:8px;font-size:15px;">${c.cancellationTitle}</div>
                  <div style="color:#78350f;font-size:14px;">{{cancellationPolicy}}</div>
                </div>
                {{/if}}
                <p style="margin:0 0 16px 0;font-size:15px;color:#475569;line-height:1.5;">${c.rescheduleMsg}</p>
                <p style="margin:0 0 16px 0;font-size:15px;color:#475569;line-height:1.5;">${c.reminderMsg}</p>`;
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

{{#if technicianName}}
${c.textTechHeader}:
{{technicianName}}
{{#if technicianEmail}}${c.textTechEmail}: {{technicianEmail}}{{/if}}
{{#if technicianPhone}}${c.textTechPhone}: {{technicianPhone}}{{/if}}
{{/if}}

{{#if calendarLink}}
${c.textCalendar}: {{calendarLink}}
{{/if}}

{{#if cancellationPolicy}}
${c.textCancelHeader}:
{{cancellationPolicy}}
{{/if}}

${c.rescheduleMsg}

${c.reminderMsg}`;
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
