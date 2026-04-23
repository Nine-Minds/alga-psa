/**
 * Source-of-truth: time-entry-approved email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'time-entry-approved';
const SUBTYPE_NAME = 'Time Entry Approved';

const SUBJECTS = {
  en: 'Time Entry Approved',
  fr: 'Saisie de temps approuv\u00e9e',
  es: 'Registro de tiempo aprobado',
  de: 'Zeiteintrag genehmigt',
  nl: 'Tijdregistratie goedgekeurd',
  it: 'Voce di tempo approvata',
  pl: 'Wpis czasu zatwierdzony',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Time Entry Approved',
    intro: 'Your time entry has been approved.',
    date: 'Date',
    duration: 'Duration',
    project: 'Project',
    task: 'Task',
    approvedBy: 'Approved By',
    viewButton: 'View Time Entry',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Time Entry Approved',
    textIntro: 'Your time entry has been approved:',
    textView: 'View time entry at',
  },
  fr: {
    headerLabel: 'Saisie de temps approuv\u00e9e',
    intro: 'Votre saisie de temps a \u00e9t\u00e9 approuv\u00e9e.',
    date: 'Date',
    duration: 'Dur\u00e9e',
    project: 'Projet',
    task: 'T\u00e2che',
    approvedBy: 'Approuv\u00e9e par',
    viewButton: 'Voir la saisie',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Saisie de temps approuv\u00e9e',
    textIntro: 'Votre saisie de temps a \u00e9t\u00e9 approuv\u00e9e :',
    textView: 'Voir la saisie sur',
  },
  es: {
    headerLabel: 'Registro de tiempo aprobado',
    intro: 'Su registro de tiempo ha sido aprobado.',
    date: 'Fecha',
    duration: 'Duraci\u00f3n',
    project: 'Proyecto',
    task: 'Tarea',
    approvedBy: 'Aprobado por',
    viewButton: 'Ver registro',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Registro de tiempo aprobado',
    textIntro: 'Su registro de tiempo ha sido aprobado:',
    textView: 'Ver registro en',
  },
  de: {
    headerLabel: 'Zeiteintrag genehmigt',
    intro: 'Ihr Zeiteintrag wurde genehmigt.',
    date: 'Datum',
    duration: 'Dauer',
    project: 'Projekt',
    task: 'Aufgabe',
    approvedBy: 'Genehmigt von',
    viewButton: 'Zeiteintrag anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Zeiteintrag genehmigt',
    textIntro: 'Ihr Zeiteintrag wurde genehmigt:',
    textView: 'Zeiteintrag anzeigen unter',
  },
  nl: {
    headerLabel: 'Tijdregistratie goedgekeurd',
    intro: 'Uw tijdregistratie is goedgekeurd.',
    date: 'Datum',
    duration: 'Duur',
    project: 'Project',
    task: 'Taak',
    approvedBy: 'Goedgekeurd door',
    viewButton: 'Tijdregistratie bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Tijdregistratie goedgekeurd',
    textIntro: 'Uw tijdregistratie is goedgekeurd:',
    textView: 'Tijdregistratie bekijken op',
  },
  it: {
    headerLabel: 'Voce di tempo approvata',
    intro: 'La Sua voce di tempo \u00e8 stata approvata.',
    date: 'Data',
    duration: 'Durata',
    project: 'Progetto',
    task: 'Attivit\u00e0',
    approvedBy: 'Approvata da',
    viewButton: 'Visualizza voce di tempo',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Voce di tempo approvata',
    textIntro: 'La Sua voce di tempo \u00e8 stata approvata:',
    textView: 'Visualizza la voce di tempo su',
  },
  pl: {
    headerLabel: 'Wpis czasu zatwierdzony',
    intro: 'Twój wpis czasu zosta\u0142 zatwierdzony.',
    date: 'Data',
    duration: 'Czas trwania',
    project: 'Projekt',
    task: 'Zadanie',
    approvedBy: 'Zatwierdzi\u0142(a)',
    viewButton: 'Zobacz wpis czasu',
    footer: 'Powered by Alga PSA',
    textHeader: 'Wpis czasu zatwierdzony',
    textIntro: 'Twój wpis czasu zosta\u0142 zatwierdzony:',
    textView: 'Zobacz wpis czasu na',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.date}</td>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.task}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.task}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.approvedBy}</td>
                    <td style="padding:12px 0;">{{timeEntry.approvedBy}}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{timeEntry.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.date}: {{timeEntry.date}}
${c.duration}: {{timeEntry.duration}}
${c.project}: {{timeEntry.project}}
${c.task}: {{timeEntry.task}}
${c.approvedBy}: {{timeEntry.approvedBy}}

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
