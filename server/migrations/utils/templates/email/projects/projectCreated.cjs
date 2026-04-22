/**
 * Source-of-truth: project-created email template.
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

const TEMPLATE_NAME = 'project-created';
const SUBTYPE_NAME = 'Project Created';

const SUBJECTS = {
  en: 'New Project Created: {{project.name}}',
  fr: 'Nouveau projet cr\u00e9\u00e9 : {{project.name}}',
  es: 'Nuevo proyecto creado: {{project.name}}',
  de: 'Neues Projekt erstellt: {{project.name}}',
  nl: 'Nieuw project aangemaakt: {{project.name}}',
  it: 'Nuovo progetto creato: {{project.name}}',
  pl: 'Nowy projekt utworzony: {{project.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'New Project Created',
    intro: 'A new project has been created:',
    projectName: 'Project Name',
    description: 'Description',
    startDate: 'Start Date',
    projectManager: 'Project Manager',
    viewButton: 'View Project',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'New Project Created',
    textIntro: 'A new project has been created:',
    textView: 'View project at',
  },
  fr: {
    headerLabel: 'Nouveau projet cr\u00e9\u00e9',
    intro: 'Un nouveau projet a \u00e9t\u00e9 cr\u00e9\u00e9 :',
    projectName: 'Nom du projet',
    description: 'Description',
    startDate: 'Date de d\u00e9but',
    projectManager: 'Chef de projet',
    viewButton: 'Voir le projet',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Nouveau projet cr\u00e9\u00e9',
    textIntro: 'Un nouveau projet a \u00e9t\u00e9 cr\u00e9\u00e9 :',
    textView: 'Voir le projet sur',
  },
  es: {
    headerLabel: 'Nuevo proyecto creado',
    intro: 'Se ha creado un nuevo proyecto:',
    projectName: 'Nombre del proyecto',
    description: 'Descripci\u00f3n',
    startDate: 'Fecha de inicio',
    projectManager: 'Jefe de proyecto',
    viewButton: 'Ver proyecto',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Nuevo proyecto creado',
    textIntro: 'Se ha creado un nuevo proyecto:',
    textView: 'Ver proyecto en',
  },
  de: {
    headerLabel: 'Neues Projekt erstellt',
    intro: 'Ein neues Projekt wurde erstellt:',
    projectName: 'Projektname',
    description: 'Beschreibung',
    startDate: 'Startdatum',
    projectManager: 'Projektleiter',
    viewButton: 'Projekt anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Neues Projekt erstellt',
    textIntro: 'Ein neues Projekt wurde erstellt:',
    textView: 'Projekt anzeigen unter',
  },
  nl: {
    headerLabel: 'Nieuw project aangemaakt',
    intro: 'Er is een nieuw project aangemaakt:',
    projectName: 'Projectnaam',
    description: 'Beschrijving',
    startDate: 'Startdatum',
    projectManager: 'Projectmanager',
    viewButton: 'Project bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Nieuw project aangemaakt',
    textIntro: 'Er is een nieuw project aangemaakt:',
    textView: 'Project bekijken op',
  },
  it: {
    headerLabel: 'Nuovo progetto creato',
    intro: '\u00c8 stato creato un nuovo progetto:',
    projectName: 'Nome del progetto',
    description: 'Descrizione',
    startDate: 'Data di inizio',
    projectManager: 'Project manager',
    viewButton: 'Visualizza progetto',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Nuovo progetto creato',
    textIntro: '\u00c8 stato creato un nuovo progetto:',
    textView: 'Visualizza progetto su',
  },
  pl: {
    headerLabel: 'Nowy projekt utworzony',
    intro: 'Utworzono nowy projekt:',
    projectName: 'Nazwa projektu',
    description: 'Opis',
    startDate: 'Data rozpocz\u0119cia',
    projectManager: 'Kierownik projektu',
    viewButton: 'Zobacz projekt',
    footer: 'Powered by Alga PSA',
    textHeader: 'Nowy projekt utworzony',
    textIntro: 'Utworzono nowy projekt:',
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
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.projectManager}</td>
                    <td style="padding:12px 0;">{{project.manager}}</td>
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
${c.projectManager}: {{project.manager}}

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
