/**
 * Source-of-truth: ticket-comment-added-client email template (client-facing).
 *
 * Sent to the requester contact, external watchers and copied addresses when a
 * public comment is added to a ticket. Simplified counterpart of the MSP
 * ticket-comment-added template: keeps the status/priority, the comment author,
 * the assigned agent's name and the comment, but drops MSP-internal details
 * (assignee email, requester contact block, board/category/location rows).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  COMMENT_BOX_BG,
  COMMENT_BOX_BORDER,
  COMMENT_LABEL_COLOR,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-comment-added-client';
const SUBTYPE_NAME = 'Ticket Comment Added Client';

const SUBJECTS = {
  en: 'New Comment on Your Ticket • {{ticket.title}}',
  fr: 'Nouveau commentaire sur votre ticket • {{ticket.title}}',
  es: 'Nuevo comentario en su ticket • {{ticket.title}}',
  de: 'Neuer Kommentar zu Ihrem Ticket • {{ticket.title}}',
  nl: 'Nieuwe opmerking bij uw ticket • {{ticket.title}}',
  it: 'Nuovo commento sul suo ticket • {{ticket.title}}',
  pl: 'Nowy komentarz do Twojego zgłoszenia • {{ticket.title}}',
  pt: 'Novo comentário no seu ticket • {{ticket.title}}',
  sv: 'Ny kommentar i ditt ärende • {{ticket.title}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'New Comment',
    intro: 'A new comment has been added to your ticket for <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    commentBy: 'Comment By',
    assignedTo: 'Assigned To',
    commentLabel: '&#x1F4AC; Comment',
    viewButton: 'View Ticket',
    footer: 'Powered by AlgaPSA &middot; Keeping teams aligned',
    textHeader: 'New Comment on Your Ticket',
    textComment: 'Comment',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Nouveau Commentaire',
    intro: 'Un nouveau commentaire a été ajouté à votre ticket pour <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Priorité',
    status: 'Statut',
    commentBy: 'Commentaire de',
    assignedTo: 'Assigné à',
    commentLabel: '&#x1F4AC; Commentaire',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by AlgaPSA &middot; Gardons les équipes alignées',
    textHeader: 'Nouveau commentaire sur votre ticket',
    textComment: 'Commentaire',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Nuevo Comentario',
    intro: 'Se ha agregado un nuevo comentario a su ticket para <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    commentBy: 'Comentario de',
    assignedTo: 'Asignado a',
    commentLabel: '&#x1F4AC; Comentario',
    viewButton: 'Ver Ticket',
    footer: 'Powered by AlgaPSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Nuevo comentario en su ticket',
    textComment: 'Comentario',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Neuer Kommentar',
    intro: 'Zu Ihrem Ticket für <strong>{{ticket.clientName}}</strong> wurde ein neuer Kommentar hinzugefügt.',
    badgePrefix: 'Ticket #',
    priority: 'Priorität',
    status: 'Status',
    commentBy: 'Kommentar von',
    assignedTo: 'Zugewiesen an',
    commentLabel: '&#x1F4AC; Kommentar',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textHeader: 'Neuer Kommentar zu Ihrem Ticket',
    textComment: 'Kommentar',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Nieuwe Opmerking',
    intro: 'Er is een nieuwe opmerking toegevoegd aan uw ticket voor <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    commentBy: 'Opmerking van',
    assignedTo: 'Toegewezen aan',
    commentLabel: '&#x1F4AC; Opmerking',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by AlgaPSA &middot; Teams op één lijn houden',
    textHeader: 'Nieuwe opmerking bij uw ticket',
    textComment: 'Opmerking',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Nuovo commento',
    intro: 'È stato aggiunto un nuovo commento al suo ticket per <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Priorità',
    status: 'Stato',
    commentBy: 'Commento di',
    assignedTo: 'Assegnato a',
    commentLabel: '&#x1F4AC; Commento',
    viewButton: 'Apri ticket',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textHeader: 'Nuovo commento sul suo ticket',
    textComment: 'Commento',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Nowy komentarz',
    intro: 'Do Twojego zgłoszenia dla <strong>{{ticket.clientName}}</strong> dodano nowy komentarz.',
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    commentBy: 'Autor komentarza',
    assignedTo: 'Przypisane do',
    commentLabel: '&#x1F4AC; Komentarz',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Nowy komentarz do Twojego zgłoszenia',
    textComment: 'Komentarz',
    textView: 'Zobacz zgłoszenie',
  },
  pt: {
    headerLabel: 'Novo comentário',
    intro: 'Um novo comentário foi adicionado ao seu ticket para <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Prioridade',
    status: 'Status',
    commentBy: 'Comentado por',
    assignedTo: 'Atribuído a',
    commentLabel: '&#x1F4AC; Comentário',
    viewButton: 'Ver ticket',
    footer: 'Powered by AlgaPSA &middot; Mantendo as equipes alinhadas',
    textHeader: 'Novo comentário no seu ticket',
    textComment: 'Comentário',
    textView: 'Ver ticket',
  },
  sv: {
    headerLabel: 'Ny kommentar',
    intro: 'En ny kommentar har lagts till i ditt ärende för <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ärende #',
    priority: 'Prioritet',
    status: 'Status',
    commentBy: 'Kommenterat av',
    assignedTo: 'Tilldelat till',
    commentLabel: '&#x1F4AC; Kommentar',
    viewButton: 'Visa ärende',
    footer: 'Drivs av AlgaPSA &middot; För samspelta team',
    textHeader: 'Ny kommentar i ditt ärende',
    textComment: 'Kommentar',
    textView: 'Visa ärende',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">${c.badgePrefix}{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.priority}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.status}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.commentBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{comment.author}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.assignedTo}</td>
                    <td style="padding:12px 0;">{{ticket.assignedToName}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${COMMENT_BOX_BG};border:1px solid ${COMMENT_BOX_BORDER};">
                  <div style="font-weight:600;color:${COMMENT_LABEL_COLOR};margin-bottom:8px;">${c.commentLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{{comment.content}}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}
${c.commentBy}: {{comment.author}}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.assignedTo}: {{ticket.assignedToName}}

${c.textComment}:
{{{comment.content}}}

${c.textView}: {{ticket.url}}`;
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
        headerTitle: '{{ticket.title}}',
        headerMeta: '{{ticket.metaLine}}',
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
