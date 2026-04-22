/**
 * Source-of-truth: project-assigned email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-assigned';
const SUBTYPE_NAME = 'Project Assigned';

const SUBJECTS = {
  en: 'You have been assigned to project: {{project.name}}',
  fr: 'Vous avez \u00e9t\u00e9 assign\u00e9 au projet : {{project.name}}',
  es: 'Te han asignado al proyecto: {{project.name}}',
  de: 'Sie wurden dem Projekt zugewiesen: {{project.name}}',
  nl: 'U bent toegewezen aan het project: {{project.name}}',
  it: 'Ti \u00e8 stato assegnato il progetto: {{project.name}}',
  pl: 'Zosta\u0142e\u015b przypisany do projektu: {{project.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Project Assigned',
    intro: 'You have been assigned to a project:',
    projectName: 'Project Name',
    description: 'Description',
    startDate: 'Start Date',
    assignedBy: 'Assigned By',
    viewButton: 'View Project',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Project Assigned',
    textIntro: 'You have been assigned to a project:',
    textView: 'View project at',
  },
  fr: {
    headerLabel: 'Projet assign\u00e9',
    intro: 'Vous avez \u00e9t\u00e9 assign\u00e9 \u00e0 un projet :',
    projectName: 'Nom du projet',
    description: 'Description',
    startDate: 'Date de d\u00e9but',
    assignedBy: 'Assign\u00e9 par',
    viewButton: 'Voir le projet',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Projet assign\u00e9',
    textIntro: 'Vous avez \u00e9t\u00e9 assign\u00e9 \u00e0 un projet :',
    textView: 'Voir le projet sur',
  },
  es: {
    headerLabel: 'Proyecto asignado',
    intro: 'Te han asignado a un proyecto:',
    projectName: 'Nombre del proyecto',
    description: 'Descripci\u00f3n',
    startDate: 'Fecha de inicio',
    assignedBy: 'Asignado por',
    viewButton: 'Ver proyecto',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Proyecto asignado',
    textIntro: 'Te han asignado a un proyecto:',
    textView: 'Ver proyecto en',
  },
  de: {
    headerLabel: 'Projekt zugewiesen',
    intro: 'Sie wurden einem Projekt zugewiesen:',
    projectName: 'Projektname',
    description: 'Beschreibung',
    startDate: 'Startdatum',
    assignedBy: 'Zugewiesen von',
    viewButton: 'Projekt anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Projekt zugewiesen',
    textIntro: 'Sie wurden einem Projekt zugewiesen:',
    textView: 'Projekt anzeigen unter',
  },
  nl: {
    headerLabel: 'Project toegewezen',
    intro: 'U bent toegewezen aan een project:',
    projectName: 'Projectnaam',
    description: 'Beschrijving',
    startDate: 'Startdatum',
    assignedBy: 'Toegewezen door',
    viewButton: 'Project bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Project toegewezen',
    textIntro: 'U bent toegewezen aan een project:',
    textView: 'Project bekijken op',
  },
  it: {
    headerLabel: 'Progetto assegnato',
    intro: 'Ti \u00e8 stato assegnato un progetto:',
    projectName: 'Nome del progetto',
    description: 'Descrizione',
    startDate: 'Data di inizio',
    assignedBy: 'Assegnato da',
    viewButton: 'Visualizza progetto',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Progetto assegnato',
    textIntro: 'Ti \u00e8 stato assegnato un progetto:',
    textView: 'Visualizza progetto su',
  },
  pl: {
    headerLabel: 'Projekt przypisany',
    intro: 'Zosta\u0142e\u015b przypisany do projektu:',
    projectName: 'Nazwa projektu',
    description: 'Opis',
    startDate: 'Data rozpocz\u0119cia',
    assignedBy: 'Przypisa\u0142(a)',
    viewButton: 'Zobacz projekt',
    footer: 'Powered by Alga PSA',
    textHeader: 'Projekt przypisany',
    textIntro: 'Zosta\u0142e\u015b przypisany do projektu:',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.description}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.description}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.startDate}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.startDate}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.assignedBy}</td>
                    <td style="padding:12px 0;">{{project.assignedBy}}</td>
                  </tr>
                </table>
                <div style="margin-top:24px;">
                  <a href="{{project.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.projectName}: {{project.name}}
${c.description}: {{project.description}}
${c.startDate}: {{project.startDate}}
${c.assignedBy}: {{project.assignedBy}}

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
