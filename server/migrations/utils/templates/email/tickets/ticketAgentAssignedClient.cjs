/**
 * Source-of-truth: ticket-agent-assigned-client email template (client-facing).
 *
 * Sent to the primary client/contact on a ticket when an individual agent is
 * assigned AFTER the ticket was already created. Layout mirrors the MSP
 * ticket-assigned template so both audiences see consistent structure; the
 * wording is client-facing ("has been assigned to your ticket", not "you have
 * been assigned").
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-agent-assigned-client';
const SUBTYPE_NAME = 'Ticket Agent Assigned Client';

const SUBJECTS = {
  en: 'Your Ticket Is Being Worked On \u2022 {{ticket.title}}',
  fr: 'Votre ticket est en cours de traitement \u2022 {{ticket.title}}',
  es: 'Su ticket est\u00e1 siendo atendido \u2022 {{ticket.title}}',
  de: 'Ihr Ticket wird bearbeitet \u2022 {{ticket.title}}',
  nl: 'Uw ticket wordt behandeld \u2022 {{ticket.title}}',
  it: 'Il suo ticket \u00e8 in lavorazione \u2022 {{ticket.title}}',
  pl: 'Twoje zg\u0142oszenie jest w trakcie obs\u0142ugi \u2022 {{ticket.title}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Agent Assigned',
    intro: "<strong>{{ticket.assignedToName}}</strong> has been assigned to your ticket for <strong>{{ticket.clientName}}</strong>. They'll be in touch shortly with updates.",
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    assignedTo: 'Assigned To',
    board: 'Board',
    category: 'Category',
    requester: 'Requester',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Your Ticket Is Being Worked On',
    textAssigned: 'Assigned To',
    textRequester: 'Requester',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Agent assign\u00e9',
    intro: "<strong>{{ticket.assignedToName}}</strong> a \u00e9t\u00e9 assign\u00e9 \u00e0 votre ticket pour <strong>{{ticket.clientName}}</strong>. Il reviendra vers vous sous peu avec des mises \u00e0 jour.",
    badgePrefix: 'Ticket #',
    priority: 'Priorit\u00e9',
    status: 'Statut',
    assignedTo: 'Assign\u00e9 \u00e0',
    board: 'Tableau',
    category: 'Cat\u00e9gorie',
    requester: 'Demandeur',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'Votre ticket est en cours de traitement',
    textAssigned: 'Assign\u00e9 \u00e0',
    textRequester: 'Demandeur',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Agente asignado',
    intro: "<strong>{{ticket.assignedToName}}</strong> ha sido asignado a su ticket para <strong>{{ticket.clientName}}</strong>. Se pondr\u00e1 en contacto con usted en breve con novedades.",
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    assignedTo: 'Asignado a',
    board: 'Tablero',
    category: 'Categor\u00eda',
    requester: 'Solicitante',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Su ticket est\u00e1 siendo atendido',
    textAssigned: 'Asignado a',
    textRequester: 'Solicitante',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Agent zugewiesen',
    intro: "<strong>{{ticket.assignedToName}}</strong> wurde Ihrem Ticket f\u00fcr <strong>{{ticket.clientName}}</strong> zugewiesen. Er/Sie meldet sich in K\u00fcrze mit Updates bei Ihnen.",
    badgePrefix: 'Ticket #',
    priority: 'Priorit\u00e4t',
    status: 'Status',
    assignedTo: 'Zugewiesen an',
    board: 'Board',
    category: 'Kategorie',
    requester: 'Anforderer',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Ihr Ticket wird bearbeitet',
    textAssigned: 'Zugewiesen an',
    textRequester: 'Anforderer',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Medewerker toegewezen',
    intro: "<strong>{{ticket.assignedToName}}</strong> is toegewezen aan uw ticket voor <strong>{{ticket.clientName}}</strong>. Hij/zij neemt binnenkort contact met u op met updates.",
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    assignedTo: 'Toegewezen aan',
    board: 'Bord',
    category: 'Categorie',
    requester: 'Aanvrager',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'Uw ticket wordt behandeld',
    textAssigned: 'Toegewezen aan',
    textRequester: 'Aanvrager',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Agente assegnato',
    intro: "<strong>{{ticket.assignedToName}}</strong> \u00e8 stato assegnato al suo ticket per <strong>{{ticket.clientName}}</strong>. La contatter\u00e0 a breve con aggiornamenti.",
    badgePrefix: 'Ticket #',
    priority: 'Priorit\u00e0',
    status: 'Stato',
    assignedTo: 'Assegnato a',
    board: 'Board',
    category: 'Categoria',
    requester: 'Richiedente',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Il suo ticket \u00e8 in lavorazione',
    textAssigned: 'Assegnato a',
    textRequester: 'Richiedente',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Agent przypisany',
    intro: "<strong>{{ticket.assignedToName}}</strong> zosta\u0142(a) przypisany(a) do Twojego zg\u0142oszenia dla <strong>{{ticket.clientName}}</strong>. Wkr\u00f3tce skontaktuje si\u0119 z Tob\u0105 w sprawie aktualizacji.",
    badgePrefix: 'Zg\u0142oszenie #',
    priority: 'Priorytet',
    status: 'Status',
    assignedTo: 'Przypisane do',
    board: 'Tablica',
    category: 'Kategoria',
    requester: 'Zg\u0142aszaj\u0105cy',
    viewButton: 'Zobacz zg\u0142oszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Twoje zg\u0142oszenie jest w trakcie obs\u0142ugi',
    textAssigned: 'Przypisane do',
    textRequester: 'Zg\u0142aszaj\u0105cy',
    textView: 'Zobacz zg\u0142oszenie',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.assignedTo}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
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
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.requester}</td>
                    <td style="padding:12px 0;">{{ticket.requesterName}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;"></div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.textAssigned}: {{ticket.assignedDetails}}
${c.board}: {{ticket.board}}
${c.category}: {{ticket.categoryDetails}}
${c.textRequester}: {{ticket.requesterName}}

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
