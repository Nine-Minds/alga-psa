/**
 * Source-of-truth: task-comment-added email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
  COMMENT_BOX_BG,
  COMMENT_BOX_BORDER,
  COMMENT_LABEL_COLOR,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'task-comment-added';
const SUBTYPE_NAME = 'Task Comment Added';

const SUBJECTS = {
  en: 'New Comment on Task: {{task.name}}',
  fr: 'Nouveau commentaire sur la t\u00e2che : {{task.name}}',
  es: 'Nuevo comentario en la tarea: {{task.name}}',
  de: 'Neuer Kommentar zur Aufgabe: {{task.name}}',
  nl: 'Nieuwe opmerking bij taak: {{task.name}}',
  it: 'Nuovo commento sulla task: {{task.name}}',
  pl: 'Nowy komentarz do zadania: {{task.name}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'New Task Comment',
    intro: '<strong>{{comment.author}}</strong> added a comment to task <strong>{{task.name}}</strong> in project <strong>{{project.name}}</strong>.',
    taskName: 'Task',
    project: 'Project',
    commentBy: 'Comment By',
    commentLabel: '&#x1F4AC; Comment',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'View Task',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'New Task Comment',
    textIntro: '{{comment.author}} added a comment to task "{{task.name}}" in project "{{project.name}}".',
    textComment: 'Comment',
    textView: 'View task at',
  },
  fr: {
    headerLabel: 'Nouveau commentaire de t\u00e2che',
    intro: '<strong>{{comment.author}}</strong> a ajout\u00e9 un commentaire \u00e0 la t\u00e2che <strong>{{task.name}}</strong> dans le projet <strong>{{project.name}}</strong>.',
    taskName: 'T\u00e2che',
    project: 'Projet',
    commentBy: 'Comment\u00e9 par',
    commentLabel: '&#x1F4AC; Commentaire',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'Voir la t\u00e2che',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Nouveau commentaire de t\u00e2che',
    textIntro: '{{comment.author}} a ajout\u00e9 un commentaire \u00e0 la t\u00e2che \u00ab {{task.name}} \u00bb dans le projet \u00ab {{project.name}} \u00bb.',
    textComment: 'Commentaire',
    textView: 'Voir la t\u00e2che sur',
  },
  es: {
    headerLabel: 'Nuevo comentario en tarea',
    intro: '<strong>{{comment.author}}</strong> a\u00f1adi\u00f3 un comentario a la tarea <strong>{{task.name}}</strong> en el proyecto <strong>{{project.name}}</strong>.',
    taskName: 'Tarea',
    project: 'Proyecto',
    commentBy: 'Comentado por',
    commentLabel: '&#x1F4AC; Comentario',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'Ver tarea',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Nuevo comentario en tarea',
    textIntro: '{{comment.author}} a\u00f1adi\u00f3 un comentario a la tarea "{{task.name}}" en el proyecto "{{project.name}}".',
    textComment: 'Comentario',
    textView: 'Ver tarea en',
  },
  de: {
    headerLabel: 'Neuer Aufgabenkommentar',
    intro: '<strong>{{comment.author}}</strong> hat einen Kommentar zur Aufgabe <strong>{{task.name}}</strong> im Projekt <strong>{{project.name}}</strong> hinzugef\u00fcgt.',
    taskName: 'Aufgabe',
    project: 'Projekt',
    commentBy: 'Kommentiert von',
    commentLabel: '&#x1F4AC; Kommentar',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'Aufgabe anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Neuer Aufgabenkommentar',
    textIntro: '{{comment.author}} hat einen Kommentar zur Aufgabe \u201e{{task.name}}\u201c im Projekt \u201e{{project.name}}\u201c hinzugef\u00fcgt.',
    textComment: 'Kommentar',
    textView: 'Aufgabe anzeigen unter',
  },
  nl: {
    headerLabel: 'Nieuwe taakopmerking',
    intro: '<strong>{{comment.author}}</strong> heeft een opmerking toegevoegd aan taak <strong>{{task.name}}</strong> in project <strong>{{project.name}}</strong>.',
    taskName: 'Taak',
    project: 'Project',
    commentBy: 'Opmerking door',
    commentLabel: '&#x1F4AC; Opmerking',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'Taak bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Nieuwe taakopmerking',
    textIntro: '{{comment.author}} heeft een opmerking toegevoegd aan taak "{{task.name}}" in project "{{project.name}}".',
    textComment: 'Opmerking',
    textView: 'Taak bekijken op',
  },
  it: {
    headerLabel: 'Nuovo commento sulla task',
    intro: '<strong>{{comment.author}}</strong> ha aggiunto un commento alla task <strong>{{task.name}}</strong> nel progetto <strong>{{project.name}}</strong>.',
    taskName: 'Task',
    project: 'Progetto',
    commentBy: 'Commentato da',
    commentLabel: '&#x1F4AC; Commento',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'Visualizza task',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Nuovo commento sulla task',
    textIntro: '{{comment.author}} ha aggiunto un commento alla task \u00ab{{task.name}}\u00bb nel progetto \u00ab{{project.name}}\u00bb.',
    textComment: 'Commento',
    textView: 'Visualizza task su',
  },
  pl: {
    headerLabel: 'Nowy komentarz do zadania',
    intro: '<strong>{{comment.author}}</strong> doda\u0142(a) komentarz do zadania <strong>{{task.name}}</strong> w projekcie <strong>{{project.name}}</strong>.',
    taskName: 'Zadanie',
    project: 'Projekt',
    commentBy: 'Skomentowa\u0142(a)',
    commentLabel: '&#x1F4AC; Komentarz',
    commentVar: '{{{comment.contentHtml}}}',
    viewButton: 'Zobacz zadanie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Nowy komentarz do zadania',
    textIntro: '{{comment.author}} doda\u0142(a) komentarz do zadania "{{task.name}}" w projekcie "{{project.name}}".',
    textComment: 'Komentarz',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.project}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{project.name}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.commentBy}</td>
                    <td style="padding:12px 0;">{{comment.author}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${COMMENT_BOX_BG};border:1px solid ${COMMENT_BOX_BORDER};">
                  <div style="font-weight:600;color:${COMMENT_LABEL_COLOR};margin-bottom:8px;">${c.commentLabel}</div>
                  <div style="color:#475467;line-height:1.5;">${c.commentVar}</div>
                </div>
                <a href="{{task.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textIntro}

${c.taskName}: {{task.name}}
${c.project}: {{project.name}}
${c.commentBy}: {{comment.author}}

${c.textComment}:
{{comment.contentText}}

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
