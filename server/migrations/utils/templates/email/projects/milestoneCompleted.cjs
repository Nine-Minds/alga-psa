/**
 * Source-of-truth: milestone-completed email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'milestone-completed';
const SUBTYPE_NAME = 'Milestone Completed';

const SUBJECTS = {
  en: 'Milestone Completed: {{milestone.name}}',
  fr: 'Jalon atteint : {{milestone.name}}',
  es: 'Hito completado: {{milestone.name}}',
  de: 'Meilenstein erreicht: {{milestone.name}}',
  nl: 'Mijlpaal voltooid: {{milestone.name}}',
  it: 'Milestone completata: {{milestone.name}}',
  pl: 'Kamie\u0144 milowy osi\u0105gni\u0119ty: {{milestone.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Milestone Completed',
    intro: 'A milestone has been completed in project {{project.name}}:',
    milestone: 'Milestone',
    completionDate: 'Completion Date',
    completedBy: 'Completed By',
    projectProgress: 'Project Progress',
    viewButton: 'View Project',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Milestone Completed',
    textIntro: 'A milestone has been completed in project {{project.name}}:',
    textView: 'View project at',
  },
  fr: {
    headerLabel: 'Jalon atteint',
    intro: 'Un jalon a \u00e9t\u00e9 atteint dans le projet {{project.name}} :',
    milestone: 'Jalon',
    completionDate: 'Date d\'ach\u00e8vement',
    completedBy: 'Compl\u00e9t\u00e9 par',
    projectProgress: 'Avancement du projet',
    viewButton: 'Voir le projet',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Jalon atteint',
    textIntro: 'Un jalon a \u00e9t\u00e9 atteint dans le projet {{project.name}} :',
    textView: 'Voir le projet sur',
  },
  es: {
    headerLabel: 'Hito completado',
    intro: 'Se ha completado un hito en el proyecto {{project.name}}:',
    milestone: 'Hito',
    completionDate: 'Fecha de finalizaci\u00f3n',
    completedBy: 'Completado por',
    projectProgress: 'Progreso del proyecto',
    viewButton: 'Ver proyecto',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Hito completado',
    textIntro: 'Se ha completado un hito en el proyecto {{project.name}}:',
    textView: 'Ver proyecto en',
  },
  de: {
    headerLabel: 'Meilenstein erreicht',
    intro: 'Ein Meilenstein wurde im Projekt {{project.name}} erreicht:',
    milestone: 'Meilenstein',
    completionDate: 'Abschlussdatum',
    completedBy: 'Abgeschlossen von',
    projectProgress: 'Projektfortschritt',
    viewButton: 'Projekt anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Meilenstein erreicht',
    textIntro: 'Ein Meilenstein wurde im Projekt {{project.name}} erreicht:',
    textView: 'Projekt anzeigen unter',
  },
  nl: {
    headerLabel: 'Mijlpaal voltooid',
    intro: 'Een mijlpaal is voltooid in project {{project.name}}:',
    milestone: 'Mijlpaal',
    completionDate: 'Voltooiingsdatum',
    completedBy: 'Voltooid door',
    projectProgress: 'Projectvoortgang',
    viewButton: 'Project bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Mijlpaal voltooid',
    textIntro: 'Een mijlpaal is voltooid in project {{project.name}}:',
    textView: 'Project bekijken op',
  },
  it: {
    headerLabel: 'Milestone completata',
    intro: '\u00c8 stata completata una milestone nel progetto {{project.name}}:',
    milestone: 'Milestone',
    completionDate: 'Data di completamento',
    completedBy: 'Completata da',
    projectProgress: 'Avanzamento del progetto',
    viewButton: 'Visualizza progetto',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Milestone completata',
    textIntro: '\u00c8 stata completata una milestone nel progetto {{project.name}}:',
    textView: 'Visualizza progetto su',
  },
  pl: {
    headerLabel: 'Kamie\u0144 milowy osi\u0105gni\u0119ty',
    intro: 'Osi\u0105gni\u0119to kamie\u0144 milowy w projekcie {{project.name}}:',
    milestone: 'Kamie\u0144 milowy',
    completionDate: 'Data uko\u0144czenia',
    completedBy: 'Uko\u0144czy\u0142(a)',
    projectProgress: 'Post\u0119p projektu',
    viewButton: 'Zobacz projekt',
    footer: 'Powered by Alga PSA',
    textHeader: 'Kamie\u0144 milowy osi\u0105gni\u0119ty',
    textIntro: 'Osi\u0105gni\u0119to kamie\u0144 milowy w projekcie {{project.name}}:',
    textView: 'Zobacz projekt pod adresem',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.milestone}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{milestone.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.completionDate}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{milestone.completedDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.completedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{milestone.completedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.projectProgress}</td>
                    <td style="padding:12px 0;">{{project.progress}}%</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.milestone}: {{milestone.name}}
${c.completionDate}: {{milestone.completedDate}}
${c.completedBy}: {{milestone.completedBy}}
${c.projectProgress}: {{project.progress}}%

${c.textView}: {{project.url}}`;
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
        headerTitle: '{{milestone.name}}',
        headerMeta: '{{project.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
