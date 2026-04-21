/**
 * Source-of-truth: project-closed email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
  BRAND_DARK,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-closed';
const SUBTYPE_NAME = 'Project Closed';

const SUBJECTS = {
  en: 'Project Closed: {{project.name}}',
  fr: 'Projet cl\u00f4tur\u00e9 : {{project.name}}',
  es: 'Proyecto cerrado: {{project.name}}',
  de: 'Projekt abgeschlossen: {{project.name}}',
  nl: 'Project afgesloten: {{project.name}}',
  it: 'Progetto chiuso: {{project.name}}',
  pl: 'Projekt zamkni\u0119ty: {{project.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Project Closed',
    intro: 'A project has been closed:',
    projectName: 'Project Name',
    status: 'Status',
    changes: 'Changes',
    closedBy: 'Closed By',
    viewButton: 'View Project',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Project Closed',
    textIntro: 'A project has been closed:',
    textView: 'View project at',
  },
  fr: {
    headerLabel: 'Projet cl\u00f4tur\u00e9',
    intro: 'Un projet a \u00e9t\u00e9 cl\u00f4tur\u00e9 :',
    projectName: 'Nom du projet',
    status: 'Statut',
    changes: 'Modifications',
    closedBy: 'Cl\u00f4tur\u00e9 par',
    viewButton: 'Voir le projet',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Projet cl\u00f4tur\u00e9',
    textIntro: 'Un projet a \u00e9t\u00e9 cl\u00f4tur\u00e9 :',
    textView: 'Voir le projet sur',
  },
  es: {
    headerLabel: 'Proyecto cerrado',
    intro: 'Se ha cerrado un proyecto:',
    projectName: 'Nombre del proyecto',
    status: 'Estado',
    changes: 'Cambios',
    closedBy: 'Cerrado por',
    viewButton: 'Ver proyecto',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Proyecto cerrado',
    textIntro: 'Se ha cerrado un proyecto:',
    textView: 'Ver proyecto en',
  },
  de: {
    headerLabel: 'Projekt abgeschlossen',
    intro: 'Ein Projekt wurde abgeschlossen:',
    projectName: 'Projektname',
    status: 'Status',
    changes: '\u00c4nderungen',
    closedBy: 'Abgeschlossen von',
    viewButton: 'Projekt anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Projekt abgeschlossen',
    textIntro: 'Ein Projekt wurde abgeschlossen:',
    textView: 'Projekt anzeigen unter',
  },
  nl: {
    headerLabel: 'Project afgesloten',
    intro: 'Een project is afgesloten:',
    projectName: 'Projectnaam',
    status: 'Status',
    changes: 'Wijzigingen',
    closedBy: 'Afgesloten door',
    viewButton: 'Project bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Project afgesloten',
    textIntro: 'Een project is afgesloten:',
    textView: 'Project bekijken op',
  },
  it: {
    headerLabel: 'Progetto chiuso',
    intro: '\u00c8 stato chiuso un progetto:',
    projectName: 'Nome del progetto',
    status: 'Stato',
    changes: 'Modifiche',
    closedBy: 'Chiuso da',
    viewButton: 'Visualizza progetto',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Progetto chiuso',
    textIntro: '\u00c8 stato chiuso un progetto:',
    textView: 'Visualizza progetto su',
  },
  pl: {
    headerLabel: 'Projekt zamkni\u0119ty',
    intro: 'Projekt zosta\u0142 zamkni\u0119ty:',
    projectName: 'Nazwa projektu',
    status: 'Status',
    changes: 'Zmiany',
    closedBy: 'Zamkn\u0105\u0142(\u0119\u0142a)',
    viewButton: 'Zobacz projekt',
    footer: 'Powered by Alga PSA',
    textHeader: 'Projekt zamkni\u0119ty',
    textIntro: 'Projekt zosta\u0142 zamkni\u0119ty:',
    textView: 'Zobacz projekt pod adresem',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.projectName}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.status}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.closedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.closedBy}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.changes}</div>
                  <div style="color:#475467;line-height:1.5;">{{project.changes}}</div>
                </div>
                <a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.projectName}: {{project.name}}
${c.status}: {{project.status}}
${c.changes}:
{{project.changes}}
${c.closedBy}: {{project.closedBy}}

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
        headerTitle: '{{project.name}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
