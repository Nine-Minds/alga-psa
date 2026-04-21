/**
 * Source-of-truth: time-entry-rejected email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'time-entry-rejected';
const SUBTYPE_NAME = 'Time Entry Rejected';

const SUBJECTS = {
  en: 'Time Entry Rejected',
  fr: 'Saisie de temps refus\u00e9e',
  es: 'Registro de tiempo rechazado',
  de: 'Zeiteintrag abgelehnt',
  nl: 'Tijdregistratie afgewezen',
  it: 'Voce di tempo respinta',
  pl: 'Wpis czasu odrzucony',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Time Entry Rejected',
    intro: 'Your time entry has been rejected.',
    date: 'Date',
    duration: 'Duration',
    project: 'Project',
    task: 'Task',
    rejectedBy: 'Rejected By',
    reason: 'Reason',
    viewButton: 'View Time Entry',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Time Entry Rejected',
    textIntro: 'Your time entry has been rejected:',
    textView: 'View time entry at',
  },
  fr: {
    headerLabel: 'Saisie de temps refus\u00e9e',
    intro: 'Votre saisie de temps a \u00e9t\u00e9 refus\u00e9e.',
    date: 'Date',
    duration: 'Dur\u00e9e',
    project: 'Projet',
    task: 'T\u00e2che',
    rejectedBy: 'Refus\u00e9e par',
    reason: 'Motif',
    viewButton: 'Voir la saisie',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Saisie de temps refus\u00e9e',
    textIntro: 'Votre saisie de temps a \u00e9t\u00e9 refus\u00e9e :',
    textView: 'Voir la saisie sur',
  },
  es: {
    headerLabel: 'Registro de tiempo rechazado',
    intro: 'Su registro de tiempo ha sido rechazado.',
    date: 'Fecha',
    duration: 'Duraci\u00f3n',
    project: 'Proyecto',
    task: 'Tarea',
    rejectedBy: 'Rechazado por',
    reason: 'Motivo',
    viewButton: 'Ver registro',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Registro de tiempo rechazado',
    textIntro: 'Su registro de tiempo ha sido rechazado:',
    textView: 'Ver registro en',
  },
  de: {
    headerLabel: 'Zeiteintrag abgelehnt',
    intro: 'Ihr Zeiteintrag wurde abgelehnt.',
    date: 'Datum',
    duration: 'Dauer',
    project: 'Projekt',
    task: 'Aufgabe',
    rejectedBy: 'Abgelehnt von',
    reason: 'Grund',
    viewButton: 'Zeiteintrag anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Zeiteintrag abgelehnt',
    textIntro: 'Ihr Zeiteintrag wurde abgelehnt:',
    textView: 'Zeiteintrag anzeigen unter',
  },
  nl: {
    headerLabel: 'Tijdregistratie afgewezen',
    intro: 'Uw tijdregistratie is afgewezen.',
    date: 'Datum',
    duration: 'Duur',
    project: 'Project',
    task: 'Taak',
    rejectedBy: 'Afgewezen door',
    reason: 'Reden',
    viewButton: 'Tijdregistratie bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Tijdregistratie afgewezen',
    textIntro: 'Uw tijdregistratie is afgewezen:',
    textView: 'Tijdregistratie bekijken op',
  },
  it: {
    headerLabel: 'Voce di tempo respinta',
    intro: 'La Sua voce di tempo \u00e8 stata respinta.',
    date: 'Data',
    duration: 'Durata',
    project: 'Progetto',
    task: 'Attivit\u00e0',
    rejectedBy: 'Respinta da',
    reason: 'Motivo',
    viewButton: 'Visualizza voce di tempo',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Voce di tempo respinta',
    textIntro: 'La Sua voce di tempo \u00e8 stata respinta:',
    textView: 'Visualizza la voce di tempo su',
  },
  pl: {
    headerLabel: 'Wpis czasu odrzucony',
    intro: 'Twój wpis czasu zosta\u0142 odrzucony.',
    date: 'Data',
    duration: 'Czas trwania',
    project: 'Projekt',
    task: 'Zadanie',
    rejectedBy: 'Odrzuci\u0142(a)',
    reason: 'Powód',
    viewButton: 'Zobacz wpis czasu',
    footer: 'Powered by Alga PSA',
    textHeader: 'Wpis czasu odrzucony',
    textIntro: 'Twój wpis czasu zosta\u0142 odrzucony:',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.rejectedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{timeEntry.rejectedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.reason}</td>
                    <td style="padding:12px 0;">{{timeEntry.rejectionReason}}</td>
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
${c.rejectedBy}: {{timeEntry.rejectedBy}}
${c.reason}: {{timeEntry.rejectionReason}}

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
