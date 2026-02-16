/**
 * Source-of-truth: ticket-comment-added email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-comment-added';
const SUBTYPE_NAME = 'Ticket Comment Added';

const SUBJECTS = {
  en: 'New Comment • {{ticket.title}}',
  fr: 'Nouveau Commentaire • {{ticket.title}}',
  es: 'Nuevo Comentario • {{ticket.title}}',
  de: 'Neuer Kommentar • {{ticket.title}}',
  nl: 'Nieuwe Opmerking • {{ticket.title}}',
  it: 'Nuovo commento • {{ticket.title}}',
  pl: 'Nowy komentarz • {{ticket.title}}',
};

const COMMENT_BOX_BG = '#eff6ff';
const COMMENT_BOX_BORDER = '#bfdbfe';
const COMMENT_LABEL_COLOR = '#1e40af';

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'New Comment Added',
    intro: 'A new comment has been added to a ticket for <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    commentBy: 'Comment By',
    commentByVar: '{{comment.author}}',
    assignedTo: 'Assigned To',
    requester: 'Requester',
    board: 'Board',
    category: 'Category',
    location: 'Location',
    commentLabel: '&#x1F4AC; Comment',
    commentVar: '{{{comment.content}}}',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'New Comment Added',
    textCommentBy: 'Comment By',
    textAssigned: 'Assigned To',
    textRequester: 'Requester',
    textComment: 'Comment',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Nouveau Commentaire Ajouté',
    intro: 'Un nouveau commentaire a été ajouté à un ticket pour <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Priorité',
    status: 'Statut',
    commentBy: 'Commentaire de',
    commentByVar: '{{comment.author}}',
    assignedTo: 'Assigné à',
    requester: 'Demandeur',
    board: 'Tableau',
    category: 'Catégorie',
    location: 'Emplacement',
    commentLabel: '&#x1F4AC; Commentaire',
    commentVar: '{{comment.content}}',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Nouveau Commentaire Ajouté',
    textCommentBy: 'Commentaire de',
    textAssigned: 'Assigné à',
    textRequester: 'Demandeur',
    textComment: 'Commentaire',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Nuevo Comentario Agregado',
    intro: 'Se ha agregado un nuevo comentario a un ticket para <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    commentBy: 'Comentario de',
    commentByVar: '{{comment.author}}',
    assignedTo: 'Asignado a',
    requester: 'Solicitante',
    board: 'Tablero',
    category: 'Categoría',
    location: 'Ubicación',
    commentLabel: '&#x1F4AC; Comentario',
    commentVar: '{{comment.content}}',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Nuevo Comentario Agregado',
    textCommentBy: 'Comentario de',
    textAssigned: 'Asignado a',
    textRequester: 'Solicitante',
    textComment: 'Comentario',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Neuer Kommentar Hinzugefügt',
    intro: 'Ein neuer Kommentar wurde zu einem Ticket für <strong>{{ticket.clientName}}</strong> hinzugefügt.',
    badgePrefix: 'Ticket #',
    priority: 'Priorität',
    status: 'Status',
    commentBy: 'Kommentar von',
    commentByVar: '{{comment.author}}',
    assignedTo: 'Zugewiesen an',
    requester: 'Anforderer',
    board: 'Board',
    category: 'Kategorie',
    location: 'Standort',
    commentLabel: '&#x1F4AC; Kommentar',
    commentVar: '{{comment.content}}',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Neuer Kommentar Hinzugefügt',
    textCommentBy: 'Kommentar von',
    textAssigned: 'Zugewiesen an',
    textRequester: 'Anforderer',
    textComment: 'Kommentar',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Nieuwe Opmerking Toegevoegd',
    intro: 'Een nieuwe opmerking is toegevoegd aan een ticket voor <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    commentBy: 'Opmerking van',
    commentByVar: '{{comment.author}}',
    assignedTo: 'Toegewezen aan',
    requester: 'Aanvrager',
    board: 'Bord',
    category: 'Categorie',
    location: 'Locatie',
    commentLabel: '&#x1F4AC; Opmerking',
    commentVar: '{{comment.content}}',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Nieuwe Opmerking Toegevoegd',
    textCommentBy: 'Opmerking van',
    textAssigned: 'Toegewezen aan',
    textRequester: 'Aanvrager',
    textComment: 'Opmerking',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Nuovo commento aggiunto',
    intro: 'È stato aggiunto un nuovo commento a un ticket per <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Ticket #',
    priority: 'Priorità',
    status: 'Stato',
    commentBy: 'Commento di',
    commentByVar: '{{comment.author}}',
    assignedTo: 'Assegnato a',
    requester: 'Richiedente',
    board: 'Board',
    category: 'Categoria',
    location: 'Sede',
    commentLabel: '&#x1F4AC; Commento',
    commentVar: '{{comment.content}}',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Nuovo commento aggiunto',
    textCommentBy: 'Commento di',
    textAssigned: 'Assegnato a',
    textRequester: 'Richiedente',
    textComment: 'Commento',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Nowy komentarz',
    intro: '<strong>{{comment.authorName}}</strong> dodał(a) komentarz do zgłoszenia <strong>{{ticket.clientName}}</strong>.',
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    commentBy: null, /* PL omits the "Comment By" row; author is in intro */
    commentByVar: null,
    assignedTo: null, /* PL omits Assigned To row */
    requester: 'Zgłaszający',
    board: null, /* PL omits Board row */
    category: null, /* PL omits Category row */
    location: null, /* PL omits Location row */
    commentLabel: 'Treść komentarza',
    commentVar: '{{comment.body}}',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Nowy komentarz',
    textCommentBy: null,
    textAssigned: null,
    textRequester: 'Zgłaszający',
    textComment: 'Komentarz',
    textView: 'Zobacz zgłoszenie',
    /* PL uses a simpler table layout */
    isSimplified: true,
  },
};
/* eslint-enable max-len */

function buildBodyHtmlStandard(c) {
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">${c.commentByVar}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.assignedTo}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.requester}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.board}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.category}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.location}</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${COMMENT_BOX_BG};border:1px solid ${COMMENT_BOX_BORDER};">
                  <div style="font-weight:600;color:${COMMENT_LABEL_COLOR};margin-bottom:8px;">${c.commentLabel}</div>
                  <div style="color:#475467;line-height:1.5;">${c.commentVar}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildBodyHtmlPl(c) {
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.requester}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${COMMENT_BOX_BG};border:1px solid ${COMMENT_BOX_BORDER};">
                  <div style="font-weight:600;color:${COMMENT_LABEL_COLOR};margin-bottom:8px;">${c.commentLabel}</div>
                  <div style="color:#475467;line-height:1.5;">${c.commentVar}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildBodyHtml(c) {
  return c.isSimplified ? buildBodyHtmlPl(c) : buildBodyHtmlStandard(c);
}

function buildTextStandard(c) {
  return `${c.textHeader}

{{ticket.metaLine}}
${c.textCommentBy}: ${c.commentByVar}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.textAssigned}: {{ticket.assignedDetails}}
${c.textRequester}: {{ticket.requesterDetails}}
${c.board}: {{ticket.board}}
${c.category}: {{ticket.categoryDetails}}
${c.location}: {{ticket.locationSummary}}

${c.textComment}:
${c.commentVar}

${c.textView}: {{ticket.url}}`;
}

function buildTextPl(c) {
  return `${c.textHeader}

{{comment.authorName}} dodał(a) komentarz do zgłoszenia {{ticket.clientName}}.

Zgłoszenie #{{ticket.id}} • {{ticket.title}}
${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.textRequester}: {{ticket.requesterName}} ({{ticket.requesterContact}})

${c.textComment}:
${c.commentVar}

${c.textView}: {{ticket.url}}`;
}

function buildText(c) {
  return c.isSimplified ? buildTextPl(c) : buildTextStandard(c);
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
