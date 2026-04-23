/**
 * Source-of-truth: task-updated email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'task-updated';
const SUBTYPE_NAME = 'Task Updated';

const SUBJECTS = {
  en: 'Task Updated: {{task.name}}',
  fr: 'T\u00e2che mise \u00e0 jour : {{task.name}}',
  es: 'Tarea actualizada: {{task.name}}',
  de: 'Aufgabe aktualisiert: {{task.name}}',
  nl: 'Taak bijgewerkt: {{task.name}}',
  it: 'Task aggiornata: {{task.name}}',
  pl: 'Zadanie zaktualizowane: {{task.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Task Updated',
    intro: 'A task has been updated in project {{project.name}}:',
    taskName: 'Task Name',
    status: 'Status',
    progress: 'Progress',
    updatedBy: 'Updated By',
    viewButton: 'View Task',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Task Updated',
    textIntro: 'A task has been updated in project {{project.name}}:',
    textView: 'View task at',
  },
  fr: {
    headerLabel: 'T\u00e2che mise \u00e0 jour',
    intro: 'Une t\u00e2che a \u00e9t\u00e9 mise \u00e0 jour dans le projet {{project.name}} :',
    taskName: 'Nom de la t\u00e2che',
    status: 'Statut',
    progress: 'Avancement',
    updatedBy: 'Mis \u00e0 jour par',
    viewButton: 'Voir la t\u00e2che',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'T\u00e2che mise \u00e0 jour',
    textIntro: 'Une t\u00e2che a \u00e9t\u00e9 mise \u00e0 jour dans le projet {{project.name}} :',
    textView: 'Voir la t\u00e2che sur',
  },
  es: {
    headerLabel: 'Tarea actualizada',
    intro: 'Se ha actualizado una tarea en el proyecto {{project.name}}:',
    taskName: 'Nombre de la tarea',
    status: 'Estado',
    progress: 'Progreso',
    updatedBy: 'Actualizado por',
    viewButton: 'Ver tarea',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Tarea actualizada',
    textIntro: 'Se ha actualizado una tarea en el proyecto {{project.name}}:',
    textView: 'Ver tarea en',
  },
  de: {
    headerLabel: 'Aufgabe aktualisiert',
    intro: 'Eine Aufgabe wurde im Projekt {{project.name}} aktualisiert:',
    taskName: 'Aufgabenname',
    status: 'Status',
    progress: 'Fortschritt',
    updatedBy: 'Aktualisiert von',
    viewButton: 'Aufgabe anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Aufgabe aktualisiert',
    textIntro: 'Eine Aufgabe wurde im Projekt {{project.name}} aktualisiert:',
    textView: 'Aufgabe anzeigen unter',
  },
  nl: {
    headerLabel: 'Taak bijgewerkt',
    intro: 'Een taak is bijgewerkt in project {{project.name}}:',
    taskName: 'Taaknaam',
    status: 'Status',
    progress: 'Voortgang',
    updatedBy: 'Bijgewerkt door',
    viewButton: 'Taak bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Taak bijgewerkt',
    textIntro: 'Een taak is bijgewerkt in project {{project.name}}:',
    textView: 'Taak bekijken op',
  },
  it: {
    headerLabel: 'Task aggiornata',
    intro: '\u00c8 stata aggiornata una task nel progetto {{project.name}}:',
    taskName: 'Nome della task',
    status: 'Stato',
    progress: 'Avanzamento',
    updatedBy: 'Aggiornato da',
    viewButton: 'Visualizza task',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Task aggiornata',
    textIntro: '\u00c8 stata aggiornata una task nel progetto {{project.name}}:',
    textView: 'Visualizza task su',
  },
  pl: {
    headerLabel: 'Zadanie zaktualizowane',
    intro: 'Zadanie w projekcie {{project.name}} zosta\u0142o zaktualizowane:',
    taskName: 'Nazwa zadania',
    status: 'Status',
    progress: 'Post\u0119p',
    updatedBy: 'Zaktualizowa\u0142(a)',
    viewButton: 'Zobacz zadanie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Zadanie zaktualizowane',
    textIntro: 'Zadanie w projekcie {{project.name}} zosta\u0142o zaktualizowane:',
    textView: 'Zobacz zadanie pod adresem',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.taskName}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.status}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.progress}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.progress}}%</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.updatedBy}</td>
                    <td style="padding:12px 0;">{{task.updatedBy}}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{task.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.taskName}: {{task.name}}
${c.status}: {{task.status}}
${c.progress}: {{task.progress}}%
${c.updatedBy}: {{task.updatedBy}}

${c.textView}: {{task.url}}`;
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
        headerTitle: '{{task.name}}',
        headerMeta: '{{project.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
