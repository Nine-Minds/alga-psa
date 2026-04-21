/**
 * Source-of-truth: project-task-assigned-additional email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 *
 * Based on the modern styling from migration 20251217211644.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'project-task-assigned-additional';
const SUBTYPE_NAME = 'Project Task Assigned';

const SUBJECTS = {
  en: 'You have been added as additional resource to task: {{task.name}}',
  fr: 'Vous avez \u00e9t\u00e9 ajout\u00e9 comme ressource suppl\u00e9mentaire \u00e0 la t\u00e2che : {{task.name}}',
  es: 'Se te ha a\u00f1adido como recurso adicional a la tarea: {{task.name}}',
  de: 'Sie wurden der Aufgabe als zus\u00e4tzliche Ressource hinzugef\u00fcgt: {{task.name}}',
  nl: 'U bent toegevoegd als extra resource aan de taak: {{task.name}}',
  it: 'Sei stato aggiunto come risorsa aggiuntiva alla task: {{task.name}}',
  pl: 'Zosta\u0142e\u015b dodany jako dodatkowy zas\u00f3b do zadania: {{task.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Task Assignment',
    intro: 'Hello{{#if recipientName}} {{recipientName}}{{/if}}, you have been added as an additional resource for a project task.',
    assignedBadge: 'Additional Resource',
    badgeBg: 'rgba(138,77,234,0.12)',
    badgeColor: '#5b38b0',
    taskLabel: 'Task',
    projectLabel: 'Project',
    dueDateLabel: 'Due Date',
    assignedByLabel: 'Assigned By',
    roleLabel: 'Role',
    descriptionTitle: 'Description',
    viewButton: 'View Task',
    buttonColor: '#8A4DEA',
    footer: 'Powered by Alga PSA',
    textHeader: 'Task Assignment',
    textIntro: 'You have been added as an Additional Resource for this task:',
    textView: 'View task at',
  },
  fr: {
    headerLabel: 'Assignation de t\u00e2che',
    intro: 'Bonjour{{#if recipientName}} {{recipientName}}{{/if}}, vous avez \u00e9t\u00e9 ajout\u00e9 comme ressource suppl\u00e9mentaire pour une t\u00e2che de projet.',
    assignedBadge: 'Ressource suppl\u00e9mentaire',
    badgeBg: 'rgba(138,77,234,0.12)',
    badgeColor: '#5b38b0',
    taskLabel: 'T\u00e2che',
    projectLabel: 'Projet',
    dueDateLabel: 'Date d\'\u00e9ch\u00e9ance',
    assignedByLabel: 'Assign\u00e9 par',
    roleLabel: 'R\u00f4le',
    descriptionTitle: 'Description',
    viewButton: 'Voir la t\u00e2che',
    buttonColor: '#8A4DEA',
    footer: 'Powered by Alga PSA',
    textHeader: 'Assignation de t\u00e2che',
    textIntro: 'Vous avez \u00e9t\u00e9 ajout\u00e9 comme ressource suppl\u00e9mentaire pour cette t\u00e2che :',
    textView: 'Voir la t\u00e2che sur',
  },
  es: {
    headerLabel: 'Asignaci\u00f3n de tarea',
    intro: 'Hola{{#if recipientName}} {{recipientName}}{{/if}}, se te ha a\u00f1adido como recurso adicional para una tarea del proyecto.',
    assignedBadge: 'Recurso adicional',
    badgeBg: 'rgba(138,77,234,0.12)',
    badgeColor: '#5b38b0',
    taskLabel: 'Tarea',
    projectLabel: 'Proyecto',
    dueDateLabel: 'Fecha de vencimiento',
    assignedByLabel: 'Asignado por',
    roleLabel: 'Rol',
    descriptionTitle: 'Descripci\u00f3n',
    viewButton: 'Ver tarea',
    buttonColor: '#8A4DEA',
    footer: 'Powered by Alga PSA',
    textHeader: 'Asignaci\u00f3n de tarea',
    textIntro: 'Se te ha a\u00f1adido como recurso adicional a esta tarea:',
    textView: 'Ver tarea en',
  },
  de: {
    headerLabel: 'Aufgabenzuweisung',
    intro: 'Hallo{{#if recipientName}} {{recipientName}}{{/if}}, Sie wurden als zus\u00e4tzliche Ressource f\u00fcr eine Projektaufgabe hinzugef\u00fcgt.',
    assignedBadge: 'Zus\u00e4tzliche Ressource',
    badgeBg: 'rgba(138,77,234,0.12)',
    badgeColor: '#5b38b0',
    taskLabel: 'Aufgabe',
    projectLabel: 'Projekt',
    dueDateLabel: 'F\u00e4lligkeitsdatum',
    assignedByLabel: 'Zugewiesen von',
    roleLabel: 'Rolle',
    descriptionTitle: 'Beschreibung',
    viewButton: 'Aufgabe anzeigen',
    buttonColor: '#8A4DEA',
    footer: 'Powered by Alga PSA',
    textHeader: 'Aufgabenzuweisung',
    textIntro: 'Sie wurden als zus\u00e4tzliche Ressource f\u00fcr diese Aufgabe hinzugef\u00fcgt:',
    textView: 'Aufgabe anzeigen unter',
  },
  nl: {
    headerLabel: 'Taaktoewijzing',
    intro: 'Hallo{{#if recipientName}} {{recipientName}}{{/if}}, u bent toegevoegd als extra resource voor een projecttaak.',
    assignedBadge: 'Extra resource',
    badgeBg: 'rgba(138,77,234,0.12)',
    badgeColor: '#5b38b0',
    taskLabel: 'Taak',
    projectLabel: 'Project',
    dueDateLabel: 'Vervaldatum',
    assignedByLabel: 'Toegewezen door',
    roleLabel: 'Rol',
    descriptionTitle: 'Beschrijving',
    viewButton: 'Taak bekijken',
    buttonColor: '#8A4DEA',
    footer: 'Powered by Alga PSA',
    textHeader: 'Taaktoewijzing',
    textIntro: 'U bent toegevoegd als extra resource voor deze taak:',
    textView: 'Taak bekijken op',
  },
  it: {
    headerLabel: 'Assegnazione task',
    intro: 'Ciao{{#if recipientName}} {{recipientName}}{{/if}}, sei stato aggiunto come risorsa aggiuntiva per una task di progetto.',
    assignedBadge: 'Risorsa aggiuntiva',
    badgeBg: 'rgba(138,77,234,0.12)',
    badgeColor: '#5b38b0',
    taskLabel: 'Task',
    projectLabel: 'Progetto',
    dueDateLabel: 'Data di scadenza',
    assignedByLabel: 'Assegnato da',
    roleLabel: 'Ruolo',
    descriptionTitle: 'Descrizione',
    viewButton: 'Visualizza task',
    buttonColor: '#8A4DEA',
    footer: 'Powered by Alga PSA',
    textHeader: 'Assegnazione task',
    textIntro: 'Sei stato aggiunto come risorsa aggiuntiva per questa task:',
    textView: 'Visualizza task su',
  },
  pl: {
    headerLabel: 'Przypisanie zadania',
    intro: 'Witaj{{#if recipientName}} {{recipientName}}{{/if}}, zosta\u0142e\u015b dodany jako dodatkowy zas\u00f3b do zadania projektowego.',
    assignedBadge: 'Dodatkowy zas\u00f3b',
    badgeBg: 'rgba(138,77,234,0.12)',
    badgeColor: '#5b38b0',
    taskLabel: 'Zadanie',
    projectLabel: 'Projekt',
    dueDateLabel: 'Termin',
    assignedByLabel: 'Przypisa\u0142(a)',
    roleLabel: 'Rola',
    descriptionTitle: 'Opis',
    viewButton: 'Zobacz zadanie',
    buttonColor: '#8A4DEA',
    footer: 'Powered by Alga PSA',
    textHeader: 'Przypisanie zadania',
    textIntro: 'Zosta\u0142e\u015b dodany jako dodatkowy zas\u00f3b do tego zadania:',
    textView: 'Zobacz zadanie pod adresem',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${c.badgeBg};color:${c.badgeColor};font-size:12px;font-weight:600;letter-spacing:0.02em;">${c.assignedBadge}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.taskLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.projectLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.project}}</td>
                  </tr>
                  {{#if task.dueDate}}
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.dueDateLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.dueDate}}</td>
                  </tr>
                  {{/if}}
                  {{#if task.assignedBy}}
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.assignedByLabel}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.assignedBy}}</td>
                  </tr>
                  {{/if}}
                  {{#if task.role}}
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.roleLabel}</td>
                    <td style="padding:12px 0;">{{task.role}}</td>
                  </tr>
                  {{/if}}
                </table>
                {{#if task.description}}
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.descriptionTitle}</div>
                  <div style="color:#475467;line-height:1.5;">{{task.description}}</div>
                </div>
                {{/if}}
                <a href="{{task.url}}" style="display:inline-block;background:${c.buttonColor};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.assignedBadge}

${c.taskLabel}: {{task.name}}
${c.projectLabel}: {{task.project}}
{{#if task.dueDate}}${c.dueDateLabel}: {{task.dueDate}}{{/if}}
{{#if task.assignedBy}}${c.assignedByLabel}: {{task.assignedBy}}{{/if}}
{{#if task.role}}${c.roleLabel}: {{task.role}}{{/if}}

{{#if task.description}}${c.descriptionTitle}:
{{task.description}}{{/if}}

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
        headerMeta: '{{task.project}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
