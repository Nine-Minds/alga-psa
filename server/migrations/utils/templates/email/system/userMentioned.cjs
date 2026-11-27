'use strict';

/**
 * Source of truth: 'user-mentioned' system email template.
 *
 * One stock template serves ticket comments, task comments, and documents; the
 * mention.isTicket / mention.isTask flags pick the wording, a document being the
 * remaining case. Body content is built from per-language copy so that only text
 * differs between locales, like the other layout templates.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BRAND_PRIMARY,
  COMMENT_BOX_BG,
  COMMENT_BOX_BORDER,
  COMMENT_LABEL_COLOR,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'user-mentioned';
const SUBTYPE_NAME = 'user-mentioned';

/* eslint-disable max-len */
const COPY = {
  en: {
    subject: '{{mention.author}} mentioned you in {{mention.entityName}}',
    headerLabel: 'You Were Mentioned',
    ticketIntro: '<strong>{{mention.author}}</strong> mentioned you in a comment on ticket <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> mentioned you in a comment on task <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> mentioned you in document <strong>{{mention.entityName}}</strong>.',
    ticket: 'Ticket', ticketTitle: 'Title', task: 'Task', project: 'Project', document: 'Document',
    mentionedBy: 'Mentioned By',
    commentLabel: '&#x1F4AC; Comment',
    closingNote: 'Open it to see the mention in context and reply.',
    viewTicket: 'View Ticket', viewTask: 'View Task', viewDocument: 'View Document',
    footer: 'Powered by AlgaPSA &middot; Keeping teams aligned',
    textTicketIntro: '{{mention.author}} mentioned you in a comment on ticket {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} mentioned you in a comment on task "{{mention.entityName}}".',
    textDocumentIntro: '{{mention.author}} mentioned you in document "{{mention.entityName}}".',
    textComment: 'Comment', textView: 'View it at',
  },
  fr: {
    subject: '{{mention.author}} vous a mentionn\u00e9 dans {{mention.entityName}}',
    headerLabel: 'Vous avez \u00e9t\u00e9 mentionn\u00e9',
    ticketIntro: '<strong>{{mention.author}}</strong> vous a mentionn\u00e9 dans un commentaire sur le ticket <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> vous a mentionn\u00e9 dans un commentaire sur la t\u00e2che <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> vous a mentionn\u00e9 dans le document <strong>{{mention.entityName}}</strong>.',
    ticket: 'Ticket', ticketTitle: 'Titre', task: 'T\u00e2che', project: 'Projet', document: 'Document',
    mentionedBy: 'Mentionn\u00e9 par',
    commentLabel: '&#x1F4AC; Commentaire',
    closingNote: 'Ouvrez-le pour voir la mention dans son contexte et r\u00e9pondre.',
    viewTicket: 'Voir le ticket', viewTask: 'Voir la t\u00e2che', viewDocument: 'Voir le document',
    footer: 'Powered by AlgaPSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textTicketIntro: '{{mention.author}} vous a mentionn\u00e9 dans un commentaire sur le ticket {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} vous a mentionn\u00e9 dans un commentaire sur la t\u00e2che \u00ab {{mention.entityName}} \u00bb.',
    textDocumentIntro: '{{mention.author}} vous a mentionn\u00e9 dans le document \u00ab {{mention.entityName}} \u00bb.',
    textComment: 'Commentaire', textView: 'Voir sur',
  },
  es: {
    subject: '{{mention.author}} lo mencion\u00f3 en {{mention.entityName}}',
    headerLabel: 'Lo han mencionado',
    ticketIntro: '<strong>{{mention.author}}</strong> lo mencion\u00f3 en un comentario del ticket <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> lo mencion\u00f3 en un comentario de la tarea <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> lo mencion\u00f3 en el documento <strong>{{mention.entityName}}</strong>.',
    ticket: 'Ticket', ticketTitle: 'T\u00edtulo', task: 'Tarea', project: 'Proyecto', document: 'Documento',
    mentionedBy: 'Mencionado por',
    commentLabel: '&#x1F4AC; Comentario',
    closingNote: '\u00c1bralo para ver la menci\u00f3n en contexto y responder.',
    viewTicket: 'Ver ticket', viewTask: 'Ver tarea', viewDocument: 'Ver documento',
    footer: 'Powered by AlgaPSA &middot; Manteniendo a los equipos alineados',
    textTicketIntro: '{{mention.author}} lo mencion\u00f3 en un comentario del ticket {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} lo mencion\u00f3 en un comentario de la tarea "{{mention.entityName}}".',
    textDocumentIntro: '{{mention.author}} lo mencion\u00f3 en el documento "{{mention.entityName}}".',
    textComment: 'Comentario', textView: 'Ver en',
  },
  de: {
    subject: '{{mention.author}} hat Sie in {{mention.entityName}} erw\u00e4hnt',
    headerLabel: 'Sie wurden erw\u00e4hnt',
    ticketIntro: '<strong>{{mention.author}}</strong> hat Sie in einem Kommentar zum Ticket <strong>{{mention.entityName}}</strong> erw\u00e4hnt.',
    taskIntro: '<strong>{{mention.author}}</strong> hat Sie in einem Kommentar zur Aufgabe <strong>{{mention.entityName}}</strong> erw\u00e4hnt.',
    documentIntro: '<strong>{{mention.author}}</strong> hat Sie im Dokument <strong>{{mention.entityName}}</strong> erw\u00e4hnt.',
    ticket: 'Ticket', ticketTitle: 'Titel', task: 'Aufgabe', project: 'Projekt', document: 'Dokument',
    mentionedBy: 'Erw\u00e4hnt von',
    commentLabel: '&#x1F4AC; Kommentar',
    closingNote: '\u00d6ffnen Sie es, um die Erw\u00e4hnung im Kontext zu sehen und zu antworten.',
    viewTicket: 'Ticket anzeigen', viewTask: 'Aufgabe anzeigen', viewDocument: 'Dokument anzeigen',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textTicketIntro: '{{mention.author}} hat Sie in einem Kommentar zum Ticket {{mention.entityName}} erw\u00e4hnt.',
    textTaskIntro: '{{mention.author}} hat Sie in einem Kommentar zur Aufgabe \u201e{{mention.entityName}}\u201c erw\u00e4hnt.',
    textDocumentIntro: '{{mention.author}} hat Sie im Dokument \u201e{{mention.entityName}}\u201c erw\u00e4hnt.',
    textComment: 'Kommentar', textView: 'Anzeigen unter',
  },
  nl: {
    subject: '{{mention.author}} heeft u genoemd in {{mention.entityName}}',
    headerLabel: 'U bent genoemd',
    ticketIntro: '<strong>{{mention.author}}</strong> heeft u genoemd in een opmerking bij ticket <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> heeft u genoemd in een opmerking bij taak <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> heeft u genoemd in document <strong>{{mention.entityName}}</strong>.',
    ticket: 'Ticket', ticketTitle: 'Titel', task: 'Taak', project: 'Project', document: 'Document',
    mentionedBy: 'Genoemd door',
    commentLabel: '&#x1F4AC; Opmerking',
    closingNote: 'Open het om de vermelding in context te zien en te reageren.',
    viewTicket: 'Ticket bekijken', viewTask: 'Taak bekijken', viewDocument: 'Document bekijken',
    footer: 'Powered by AlgaPSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textTicketIntro: '{{mention.author}} heeft u genoemd in een opmerking bij ticket {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} heeft u genoemd in een opmerking bij taak "{{mention.entityName}}".',
    textDocumentIntro: '{{mention.author}} heeft u genoemd in document "{{mention.entityName}}".',
    textComment: 'Opmerking', textView: 'Bekijken op',
  },
  it: {
    subject: '{{mention.author}} ti ha menzionato in {{mention.entityName}}',
    headerLabel: 'Sei stato menzionato',
    ticketIntro: '<strong>{{mention.author}}</strong> ti ha menzionato in un commento sul ticket <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> ti ha menzionato in un commento sulla task <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> ti ha menzionato nel documento <strong>{{mention.entityName}}</strong>.',
    ticket: 'Ticket', ticketTitle: 'Titolo', task: 'Task', project: 'Progetto', document: 'Documento',
    mentionedBy: 'Menzionato da',
    commentLabel: '&#x1F4AC; Commento',
    closingNote: 'Aprilo per vedere la menzione nel contesto e rispondere.',
    viewTicket: 'Visualizza ticket', viewTask: 'Visualizza task', viewDocument: 'Visualizza documento',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textTicketIntro: '{{mention.author}} ti ha menzionato in un commento sul ticket {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} ti ha menzionato in un commento sulla task \u00ab{{mention.entityName}}\u00bb.',
    textDocumentIntro: '{{mention.author}} ti ha menzionato nel documento \u00ab{{mention.entityName}}\u00bb.',
    textComment: 'Commento', textView: 'Visualizza su',
  },
  pl: {
    subject: '{{mention.author}} wspomnia\u0142(a) o Tobie w {{mention.entityName}}',
    headerLabel: 'Wspomniano o Tobie',
    ticketIntro: '<strong>{{mention.author}}</strong> wspomnia\u0142(a) o Tobie w komentarzu do zg\u0142oszenia <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> wspomnia\u0142(a) o Tobie w komentarzu do zadania <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> wspomnia\u0142(a) o Tobie w dokumencie <strong>{{mention.entityName}}</strong>.',
    ticket: 'Zg\u0142oszenie', ticketTitle: 'Tytu\u0142', task: 'Zadanie', project: 'Projekt', document: 'Dokument',
    mentionedBy: 'Wspomnia\u0142(a)',
    commentLabel: '&#x1F4AC; Komentarz',
    closingNote: 'Otw\u00f3rz, aby zobaczy\u0107 wzmiank\u0119 w kontek\u015bcie i odpowiedzie\u0107.',
    viewTicket: 'Zobacz zg\u0142oszenie', viewTask: 'Zobacz zadanie', viewDocument: 'Zobacz dokument',
    footer: 'Powered by AlgaPSA',
    textTicketIntro: '{{mention.author}} wspomnia\u0142(a) o Tobie w komentarzu do zg\u0142oszenia {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} wspomnia\u0142(a) o Tobie w komentarzu do zadania "{{mention.entityName}}".',
    textDocumentIntro: '{{mention.author}} wspomnia\u0142(a) o Tobie w dokumencie "{{mention.entityName}}".',
    textComment: 'Komentarz', textView: 'Zobacz pod adresem',
  },
  pt: {
    subject: '{{mention.author}} mencionou voc\u00ea em {{mention.entityName}}',
    headerLabel: 'Voc\u00ea foi mencionado',
    ticketIntro: '<strong>{{mention.author}}</strong> mencionou voc\u00ea em um coment\u00e1rio no ticket <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> mencionou voc\u00ea em um coment\u00e1rio na tarefa <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> mencionou voc\u00ea no documento <strong>{{mention.entityName}}</strong>.',
    ticket: 'Ticket', ticketTitle: 'T\u00edtulo', task: 'Tarefa', project: 'Projeto', document: 'Documento',
    mentionedBy: 'Mencionado por',
    commentLabel: '&#x1F4AC; Coment\u00e1rio',
    closingNote: 'Abra para ver a men\u00e7\u00e3o no contexto e responder.',
    viewTicket: 'Ver ticket', viewTask: 'Ver tarefa', viewDocument: 'Ver documento',
    footer: 'Powered by AlgaPSA &middot; Mantendo as equipes alinhadas',
    textTicketIntro: '{{mention.author}} mencionou voc\u00ea em um coment\u00e1rio no ticket {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} mencionou voc\u00ea em um coment\u00e1rio na tarefa "{{mention.entityName}}".',
    textDocumentIntro: '{{mention.author}} mencionou voc\u00ea no documento "{{mention.entityName}}".',
    textComment: 'Coment\u00e1rio', textView: 'Ver em',
  },
  sv: {
    subject: '{{mention.author}} n\u00e4mnde dig i {{mention.entityName}}',
    headerLabel: 'Du har n\u00e4mnts',
    ticketIntro: '<strong>{{mention.author}}</strong> n\u00e4mnde dig i en kommentar p\u00e5 \u00e4rendet <strong>{{mention.entityName}}</strong>.',
    taskIntro: '<strong>{{mention.author}}</strong> n\u00e4mnde dig i en kommentar p\u00e5 uppgiften <strong>{{mention.entityName}}</strong>.',
    documentIntro: '<strong>{{mention.author}}</strong> n\u00e4mnde dig i dokumentet <strong>{{mention.entityName}}</strong>.',
    ticket: '\u00c4rende', ticketTitle: 'Titel', task: 'Uppgift', project: 'Projekt', document: 'Dokument',
    mentionedBy: 'N\u00e4mnd av',
    commentLabel: '&#x1F4AC; Kommentar',
    closingNote: '\u00d6ppna det f\u00f6r att se omn\u00e4mnandet i sitt sammanhang och svara.',
    viewTicket: 'Visa \u00e4rende', viewTask: 'Visa uppgift', viewDocument: 'Visa dokument',
    footer: 'Drivs av AlgaPSA &middot; F\u00f6r samspelta team',
    textTicketIntro: '{{mention.author}} n\u00e4mnde dig i en kommentar p\u00e5 \u00e4rendet {{mention.entityName}}.',
    textTaskIntro: '{{mention.author}} n\u00e4mnde dig i en kommentar p\u00e5 uppgiften \u201d{{mention.entityName}}\u201d.',
    textDocumentIntro: '{{mention.author}} n\u00e4mnde dig i dokumentet \u201d{{mention.entityName}}\u201d.',
    textComment: 'Kommentar', textView: 'Visa p\u00e5',
  },
};
/* eslint-enable max-len */

/** Ticket first: the settings preview renders the first branch of every conditional. */
const byEntity = (ticket, task, document) =>
  `{{#if mention.isTicket}}${ticket}{{else}}{{#if mention.isTask}}${task}{{else}}${document}{{/if}}{{/if}}`;

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${byEntity(c.ticketIntro, c.taskIntro, c.documentIntro)}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${byEntity(c.ticket, c.task, c.document)}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{mention.entityName}}</td>
                  </tr>
                  {{#if mention.contextName}}<tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">{{#if mention.isTicket}}${c.ticketTitle}{{else}}${c.project}{{/if}}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{mention.contextName}}</td>
                  </tr>{{/if}}
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.mentionedBy}</td>
                    <td style="padding:12px 0;">{{mention.author}}</td>
                  </tr>
                </table>
                {{#if mention.commentPreview}}<div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${COMMENT_BOX_BG};border:1px solid ${COMMENT_BOX_BORDER};">
                  <div style="font-weight:600;color:${COMMENT_LABEL_COLOR};margin-bottom:8px;">${c.commentLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{mention.commentPreview}}</div>
                </div>{{/if}}
                <p style="margin:20px 0 16px 0;font-size:14px;color:#475467;">${c.closingNote}</p>
                <a href="{{mention.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${byEntity(c.viewTicket, c.viewTask, c.viewDocument)}</a>`;
}

function buildText(c) {
  return `${c.headerLabel}

${byEntity(c.textTicketIntro, c.textTaskIntro, c.textDocumentIntro)}

${byEntity(c.ticket, c.task, c.document)}: {{mention.entityName}}
{{#if mention.contextName}}{{#if mention.isTicket}}${c.ticketTitle}{{else}}${c.project}{{/if}}: {{mention.contextName}}
{{/if}}${c.mentionedBy}: {{mention.author}}
{{#if mention.commentPreview}}
${c.textComment}:
{{mention.commentPreview}}
{{/if}}
${c.closingNote}

${c.textView}: {{mention.url}}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: copy.subject,
      htmlContent: wrapEmailLayout({
        language: lang,
        headerLabel: copy.headerLabel,
        headerTitle: '{{mention.entityName}}',
        headerMeta: '{{mention.contextName}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
