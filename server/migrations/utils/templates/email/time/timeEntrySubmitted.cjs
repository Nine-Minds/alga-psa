/**
 * Source-of-truth: time-entry-submitted email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'time-entry-submitted';
const SUBTYPE_NAME = 'Time Entry Submitted';

const SUBJECTS = {
  en: 'Time Entry Submitted for Review',
  fr: 'Saisie de temps soumise pour approbation',
  es: 'Registro de tiempo enviado para revisi\u00f3n',
  de: 'Zeiteintrag zur Pr\u00fcfung eingereicht',
  nl: 'Tijdregistratie ingediend ter beoordeling',
  it: 'Voce di tempo inviata per l\u2019approvazione',
  pl: 'Wpis czasu przes\u0142any do zatwierdzenia',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Time Entry Submitted',
    intro: 'A time entry has been submitted for review.',
    submittedBy: 'Submitted By',
    date: 'Date',
    duration: 'Duration',
    project: 'Project',
    task: 'Task',
    viewButton: 'Review Time Entry',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Time Entry Submitted',
    textIntro: 'A time entry has been submitted for review:',
    textView: 'Review time entry at',
  },
  fr: {
    headerLabel: 'Saisie de temps soumise',
    intro: 'Une saisie de temps a \u00e9t\u00e9 soumise pour approbation.',
    submittedBy: 'Soumise par',
    date: 'Date',
    duration: 'Dur\u00e9e',
    project: 'Projet',
    task: 'T\u00e2che',
    viewButton: 'Examiner la saisie',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Saisie de temps soumise',
    textIntro: 'Une saisie de temps a \u00e9t\u00e9 soumise pour approbation :',
    textView: 'Examiner la saisie sur',
  },
  es: {
    headerLabel: 'Registro de tiempo enviado',
    intro: 'Se ha enviado un registro de tiempo para su revisi\u00f3n.',
    submittedBy: 'Enviado por',
    date: 'Fecha',
    duration: 'Duraci\u00f3n',
    project: 'Proyecto',
    task: 'Tarea',
    viewButton: 'Revisar registro',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Registro de tiempo enviado',
    textIntro: 'Se ha enviado un registro de tiempo para su revisi\u00f3n:',
    textView: 'Revisar registro en',
  },
  de: {
    headerLabel: 'Zeiteintrag eingereicht',
    intro: 'Ein Zeiteintrag wurde zur Pr\u00fcfung eingereicht.',
    submittedBy: 'Eingereicht von',
    date: 'Datum',
    duration: 'Dauer',
    project: 'Projekt',
    task: 'Aufgabe',
    viewButton: 'Zeiteintrag pr\u00fcfen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Zeiteintrag eingereicht',
    textIntro: 'Ein Zeiteintrag wurde zur Pr\u00fcfung eingereicht:',
    textView: 'Zeiteintrag pr\u00fcfen unter',
  },
  nl: {
    headerLabel: 'Tijdregistratie ingediend',
    intro: 'Een tijdregistratie is ingediend ter beoordeling.',
    submittedBy: 'Ingediend door',
    date: 'Datum',
    duration: 'Duur',
    project: 'Project',
    task: 'Taak',
    viewButton: 'Tijdregistratie beoordelen',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Tijdregistratie ingediend',
    textIntro: 'Een tijdregistratie is ingediend ter beoordeling:',
    textView: 'Beoordeel de tijdregistratie op',
  },
  it: {
    headerLabel: 'Voce di tempo inviata',
    intro: '\u00c8 stata inviata una voce di tempo per l\u2019approvazione.',
    submittedBy: 'Inviata da',
    date: 'Data',
    duration: 'Durata',
    project: 'Progetto',
    task: 'Attivit\u00e0',
    viewButton: 'Esamina voce di tempo',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Voce di tempo inviata',
    textIntro: '\u00c8 stata inviata una voce di tempo per l\u2019approvazione:',
    textView: 'Esamina la voce di tempo su',
  },
  pl: {
    headerLabel: 'Wpis czasu przes\u0142any',
    intro: 'Wpis czasu zosta\u0142 przes\u0142any do zatwierdzenia.',
    submittedBy: 'Przes\u0142a\u0142(a)',
    date: 'Data',
    duration: 'Czas trwania',
    project: 'Projekt',
    task: 'Zadanie',
    viewButton: 'Sprawd\u017a wpis czasu',
    footer: 'Powered by Alga PSA',
    textHeader: 'Wpis czasu przes\u0142any',
    textIntro: 'Wpis czasu zosta\u0142 przes\u0142any do zatwierdzenia:',
    textView: 'Sprawd\u017a wpis czasu na',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.submittedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.submittedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.date}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.date}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.duration}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.duration}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.project}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.project}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.task}</td>
                    <td style="padding:12px 0;">{{timeEntry.task}}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{timeEntry.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.submittedBy}: {{timeEntry.submittedBy}}
${c.date}: {{timeEntry.date}}
${c.duration}: {{timeEntry.duration}}
${c.project}: {{timeEntry.project}}
${c.task}: {{timeEntry.task}}

${c.textView}: {{timeEntry.url}}`;
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
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
