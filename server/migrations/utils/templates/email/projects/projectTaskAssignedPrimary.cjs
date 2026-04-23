/**
 * Source-of-truth: project-task-assigned-primary email template.
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

const TEMPLATE_NAME = 'project-task-assigned-primary';
const SUBTYPE_NAME = 'Project Task Assigned';

const SUBJECTS = {
  en: 'You have been assigned to task: {{task.name}}',
  fr: 'Vous avez \u00e9t\u00e9 assign\u00e9 \u00e0 la t\u00e2che : {{task.name}}',
  es: 'Te han asignado a la tarea: {{task.name}}',
  de: 'Sie wurden der Aufgabe zugewiesen: {{task.name}}',
  nl: 'U bent toegewezen aan de taak: {{task.name}}',
  it: 'Ti \u00e8 stata assegnata la task: {{task.name}}',
  pl: 'Zosta\u0142e\u015b przypisany do zadania: {{task.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Task Assignment',
    intro: 'Hello{{#if recipientName}} {{recipientName}}{{/if}}, you have been assigned as the primary resource for a project task.',
    assignedBadge: 'Primary Assignee',
    badgeBg: BADGE_BG,
    badgeColor: BRAND_DARK,
    taskLabel: 'Task',
    projectLabel: 'Project',
    dueDateLabel: 'Due Date',
    assignedByLabel: 'Assigned By',
    roleLabel: 'Role',
    descriptionTitle: 'Description',
    viewButton: 'View Task',
    buttonColor: BRAND_PRIMARY,
    footer: 'Powered by Alga PSA',
    textHeader: 'Task Assignment',
    textIntro: 'You have been assigned as the Primary Assignee for this task:',
    textView: 'View task at',
  },
  fr: {
    headerLabel: 'Assignation de t\u00e2che',
    intro: 'Bonjour{{#if recipientName}} {{recipientName}}{{/if}}, vous avez \u00e9t\u00e9 assign\u00e9 comme ressource principale pour une t\u00e2che de projet.',
    assignedBadge: 'Responsable principal',
    badgeBg: BADGE_BG,
    badgeColor: BRAND_DARK,
    taskLabel: 'T\u00e2che',
    projectLabel: 'Projet',
    dueDateLabel: 'Date d\'\u00e9ch\u00e9ance',
    assignedByLabel: 'Assign\u00e9 par',
    roleLabel: 'R\u00f4le',
    descriptionTitle: 'Description',
    viewButton: 'Voir la t\u00e2che',
    buttonColor: BRAND_PRIMARY,
    footer: 'Powered by Alga PSA',
    textHeader: 'Assignation de t\u00e2che',
    textIntro: 'Vous avez \u00e9t\u00e9 assign\u00e9 comme responsable principal pour cette t\u00e2che :',
    textView: 'Voir la t\u00e2che sur',
  },
  es: {
    headerLabel: 'Asignaci\u00f3n de tarea',
    intro: 'Hola{{#if recipientName}} {{recipientName}}{{/if}}, te han asignado como recurso principal para una tarea del proyecto.',
    assignedBadge: 'Responsable principal',
    badgeBg: BADGE_BG,
    badgeColor: BRAND_DARK,
    taskLabel: 'Tarea',
    projectLabel: 'Proyecto',
    dueDateLabel: 'Fecha de vencimiento',
    assignedByLabel: 'Asignado por',
    roleLabel: 'Rol',
    descriptionTitle: 'Descripci\u00f3n',
    viewButton: 'Ver tarea',
    buttonColor: BRAND_PRIMARY,
    footer: 'Powered by Alga PSA',
    textHeader: 'Asignaci\u00f3n de tarea',
    textIntro: 'Te han asignado como responsable principal de esta tarea:',
    textView: 'Ver tarea en',
  },
  de: {
    headerLabel: 'Aufgabenzuweisung',
    intro: 'Hallo{{#if recipientName}} {{recipientName}}{{/if}}, Sie wurden als Hauptverantwortlicher f\u00fcr eine Projektaufgabe zugewiesen.',
    assignedBadge: 'Hauptverantwortlicher',
    badgeBg: BADGE_BG,
    badgeColor: BRAND_DARK,
    taskLabel: 'Aufgabe',
    projectLabel: 'Projekt',
    dueDateLabel: 'F\u00e4lligkeitsdatum',
    assignedByLabel: 'Zugewiesen von',
    roleLabel: 'Rolle',
    descriptionTitle: 'Beschreibung',
    viewButton: 'Aufgabe anzeigen',
    buttonColor: BRAND_PRIMARY,
    footer: 'Powered by Alga PSA',
    textHeader: 'Aufgabenzuweisung',
    textIntro: 'Sie wurden als Hauptverantwortlicher f\u00fcr diese Aufgabe zugewiesen:',
    textView: 'Aufgabe anzeigen unter',
  },
  nl: {
    headerLabel: 'Taaktoewijzing',
    intro: 'Hallo{{#if recipientName}} {{recipientName}}{{/if}}, u bent toegewezen als hoofdverantwoordelijke voor een projecttaak.',
    assignedBadge: 'Hoofdverantwoordelijke',
    badgeBg: BADGE_BG,
    badgeColor: BRAND_DARK,
    taskLabel: 'Taak',
    projectLabel: 'Project',
    dueDateLabel: 'Vervaldatum',
    assignedByLabel: 'Toegewezen door',
    roleLabel: 'Rol',
    descriptionTitle: 'Beschrijving',
    viewButton: 'Taak bekijken',
    buttonColor: BRAND_PRIMARY,
    footer: 'Powered by Alga PSA',
    textHeader: 'Taaktoewijzing',
    textIntro: 'U bent toegewezen als hoofdverantwoordelijke voor deze taak:',
    textView: 'Taak bekijken op',
  },
  it: {
    headerLabel: 'Assegnazione task',
    intro: 'Ciao{{#if recipientName}} {{recipientName}}{{/if}}, ti \u00e8 stata assegnata la responsabilit\u00e0 principale per una task di progetto.',
    assignedBadge: 'Responsabile principale',
    badgeBg: BADGE_BG,
    badgeColor: BRAND_DARK,
    taskLabel: 'Task',
    projectLabel: 'Progetto',
    dueDateLabel: 'Data di scadenza',
    assignedByLabel: 'Assegnato da',
    roleLabel: 'Ruolo',
    descriptionTitle: 'Descrizione',
    viewButton: 'Visualizza task',
    buttonColor: BRAND_PRIMARY,
    footer: 'Powered by Alga PSA',
    textHeader: 'Assegnazione task',
    textIntro: 'Ti \u00e8 stata assegnata la responsabilit\u00e0 principale per questa task:',
    textView: 'Visualizza task su',
  },
  pl: {
    headerLabel: 'Przypisanie zadania',
    intro: 'Witaj{{#if recipientName}} {{recipientName}}{{/if}}, zosta\u0142e\u015b przypisany jako g\u0142\u00f3wny wykonawca zadania projektowego.',
    assignedBadge: 'G\u0142\u00f3wny wykonawca',
    badgeBg: BADGE_BG,
    badgeColor: BRAND_DARK,
    taskLabel: 'Zadanie',
    projectLabel: 'Projekt',
    dueDateLabel: 'Termin',
    assignedByLabel: 'Przypisa\u0142(a)',
    roleLabel: 'Rola',
    descriptionTitle: 'Opis',
    viewButton: 'Zobacz zadanie',
    buttonColor: BRAND_PRIMARY,
    footer: 'Powered by Alga PSA',
    textHeader: 'Przypisanie zadania',
    textIntro: 'Zosta\u0142e\u015b przypisany jako g\u0142\u00f3wny wykonawca tego zadania:',
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
