/**
 * Source-of-truth: ticket-closed-client email template (client-facing).
 *
 * Sent to the requester contact, external watchers and copied addresses when a
 * ticket is closed. Simplified counterpart of the MSP ticket-closed template:
 * keeps who closed it, the assigned agent's name and the client-visible
 * resolution, but drops MSP-internal details (assignee email, requester contact
 * block, board/category/location rows). The resolution box is omitted when
 * there is no client-visible resolution.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-closed-client';
const SUBTYPE_NAME = 'Ticket Closed Client';

const SUBJECTS = {
  en: 'Your Ticket Has Been Closed • {{ticket.title}}',
  fr: 'Votre ticket a été fermé • {{ticket.title}}',
  es: 'Su ticket ha sido cerrado • {{ticket.title}}',
  de: 'Ihr Ticket wurde geschlossen • {{ticket.title}}',
  nl: 'Uw ticket is gesloten • {{ticket.title}}',
  it: 'Il suo ticket è stato chiuso • {{ticket.title}}',
  pl: 'Twoje zgłoszenie zostało zamknięte • {{ticket.title}}',
  pt: 'Seu ticket foi encerrado • {{ticket.title}}',
  sv: 'Ditt ärende har stängts • {{ticket.title}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Closed',
    intro: 'Your ticket for <strong>{{ticket.clientName}}</strong> has been resolved and closed.',
    badgePrefix: 'Ticket #',
    status: 'Status',
    closedStatusLabel: 'Closed',
    closedBy: 'Closed By',
    assignedTo: 'Assigned To',
    resolutionLabel: 'Resolution',
    viewButton: 'View Ticket',
    footer: 'Powered by AlgaPSA &middot; Keeping teams aligned',
    textHeader: 'Your Ticket Has Been Closed',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Ticket Fermé',
    intro: 'Votre ticket pour <strong>{{ticket.clientName}}</strong> a été résolu et fermé.',
    badgePrefix: 'Ticket #',
    status: 'Statut',
    closedStatusLabel: 'Fermé',
    closedBy: 'Fermé par',
    assignedTo: 'Assigné à',
    resolutionLabel: 'Résolution',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by AlgaPSA &middot; Gardons les équipes alignées',
    textHeader: 'Votre ticket a été fermé',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Ticket Cerrado',
    intro: 'Su ticket para <strong>{{ticket.clientName}}</strong> ha sido resuelto y cerrado.',
    badgePrefix: 'Ticket #',
    status: 'Estado',
    closedStatusLabel: 'Cerrado',
    closedBy: 'Cerrado por',
    assignedTo: 'Asignado a',
    resolutionLabel: 'Resolución',
    viewButton: 'Ver Ticket',
    footer: 'Powered by AlgaPSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Su ticket ha sido cerrado',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Ticket Geschlossen',
    intro: 'Ihr Ticket für <strong>{{ticket.clientName}}</strong> wurde gelöst und geschlossen.',
    badgePrefix: 'Ticket #',
    status: 'Status',
    closedStatusLabel: 'Geschlossen',
    closedBy: 'Geschlossen von',
    assignedTo: 'Zugewiesen an',
    resolutionLabel: 'Lösung',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by AlgaPSA &middot; Teams auf Kurs halten',
    textHeader: 'Ihr Ticket wurde geschlossen',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Ticket Gesloten',
    intro: 'Uw ticket voor <strong>{{ticket.clientName}}</strong> is opgelost en gesloten.',
    badgePrefix: 'Ticket #',
    status: 'Status',
    closedStatusLabel: 'Gesloten',
    closedBy: 'Gesloten door',
    assignedTo: 'Toegewezen aan',
    resolutionLabel: 'Oplossing',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by AlgaPSA &middot; Teams op één lijn houden',
    textHeader: 'Uw ticket is gesloten',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Ticket chiuso',
    intro: 'Il suo ticket per <strong>{{ticket.clientName}}</strong> è stato risolto e chiuso.',
    badgePrefix: 'Ticket #',
    status: 'Stato',
    closedStatusLabel: 'Chiuso',
    closedBy: 'Chiuso da',
    assignedTo: 'Assegnato a',
    resolutionLabel: 'Risoluzione',
    viewButton: 'Apri ticket',
    footer: 'Powered by AlgaPSA &middot; Manteniamo i team allineati',
    textHeader: 'Il suo ticket è stato chiuso',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Zgłoszenie zamknięte',
    intro: 'Twoje zgłoszenie dla <strong>{{ticket.clientName}}</strong> zostało rozwiązane i zamknięte.',
    badgePrefix: 'Zgłoszenie #',
    status: 'Status',
    closedStatusLabel: 'Zamknięte',
    closedBy: 'Zamknięto przez',
    assignedTo: 'Przypisane do',
    resolutionLabel: 'Rozwiązanie',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by AlgaPSA',
    textHeader: 'Twoje zgłoszenie zostało zamknięte',
    textView: 'Zobacz zgłoszenie',
  },
  pt: {
    headerLabel: 'Ticket encerrado',
    intro: 'Seu ticket para <strong>{{ticket.clientName}}</strong> foi resolvido e encerrado.',
    badgePrefix: 'Ticket #',
    status: 'Status',
    closedStatusLabel: 'Encerrado',
    closedBy: 'Encerrado por',
    assignedTo: 'Atribuído a',
    resolutionLabel: 'Resolução',
    viewButton: 'Ver ticket',
    footer: 'Powered by AlgaPSA &middot; Mantendo as equipes alinhadas',
    textHeader: 'Seu ticket foi encerrado',
    textView: 'Ver ticket',
  },
  sv: {
    headerLabel: 'Ärende stängt',
    intro: 'Ditt ärende för <strong>{{ticket.clientName}}</strong> har lösts och stängts.',
    badgePrefix: 'Ärende #',
    status: 'Status',
    closedStatusLabel: 'Stängt',
    closedBy: 'Stängt av',
    assignedTo: 'Tilldelat till',
    resolutionLabel: 'Lösning',
    viewButton: 'Visa ärende',
    footer: 'Drivs av AlgaPSA &middot; För samspelta team',
    textHeader: 'Ditt ärende har stängts',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.status}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:${BRAND_PRIMARY};color:#ffffff;font-weight:600;">${c.closedStatusLabel}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.closedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.assignedTo}</td>
                    <td style="padding:12px 0;">{{ticket.assignedToName}}</td>
                  </tr>
                </table>
                {{#if ticket.resolution}}<div style="margin:28px 0 0 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.resolutionLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{{ticket.resolution}}}</div>
                </div>{{/if}}
                <div style="margin-top:28px;">
                  <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>
                </div>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}

${c.status}: ${c.closedStatusLabel}
${c.closedBy}: {{ticket.closedBy}}
${c.assignedTo}: {{ticket.assignedToName}}
{{#if ticket.resolution}}
${c.resolutionLabel}:
{{{ticket.resolution}}}
{{/if}}
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
