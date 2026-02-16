/**
 * Source-of-truth: ticket-closed email template.
 *
 * Uses the shared email layout wrapper. Body content is built from
 * per-language translated strings so that only text differs between locales.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-closed';
const SUBTYPE_NAME = 'Ticket Closed';

const SUBJECTS = {
  en: 'Ticket Closed • {{ticket.title}}',
  fr: 'Ticket Fermé • {{ticket.title}}',
  es: 'Ticket Cerrado • {{ticket.title}}',
  de: 'Ticket Geschlossen • {{ticket.title}}',
  nl: 'Ticket Gesloten • {{ticket.title}}',
  it: 'Ticket chiuso • {{ticket.title}}',
  pl: 'Zgłoszenie zamknięte • {{ticket.title}} ({{ticket.priority}})',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Closed',
    intro: 'A ticket for <strong>{{ticket.clientName}}</strong> has been resolved and closed. Review the resolution details below.',
    badgePrefix: 'Ticket #',
    status: 'Status',
    closedStatusLabel: 'Closed',
    closedBy: 'Closed By',
    closedByVar: '{{ticket.closedBy}}',
    assignedTo: 'Assigned To',
    requester: 'Requester',
    board: 'Board',
    category: 'Category',
    location: 'Location',
    resolutionLabel: 'Resolution',
    resolutionVar: '{{{ticket.resolution}}}',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Ticket Closed',
    textClosedBy: 'Closed By',
    textStatus: 'Status',
    textClosedStatus: 'Closed',
    textAssigned: 'Assigned To',
    textRequester: 'Requester',
    textResolution: 'Resolution',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Ticket Fermé',
    intro: 'Un ticket a été résolu et fermé pour <strong>{{ticket.clientName}}</strong>. Consultez les détails de la résolution ci-dessous.',
    badgePrefix: 'Ticket #',
    status: 'Statut',
    closedStatusLabel: 'Fermé',
    closedBy: 'Fermé par',
    closedByVar: '{{ticket.closedBy}}',
    assignedTo: 'Assigné à',
    requester: 'Demandeur',
    board: 'Tableau',
    category: 'Catégorie',
    location: 'Emplacement',
    resolutionLabel: 'Résolution',
    resolutionVar: '{{ticket.resolution}}',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Ticket Fermé',
    textClosedBy: 'Fermé par',
    textStatus: 'Statut',
    textClosedStatus: 'Fermé',
    textAssigned: 'Assigné à',
    textRequester: 'Demandeur',
    textResolution: 'Résolution',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Ticket Cerrado',
    intro: 'Se ha resuelto y cerrado un ticket para <strong>{{ticket.clientName}}</strong>. Revisa los detalles de la resolución a continuación.',
    badgePrefix: 'Ticket #',
    status: 'Estado',
    closedStatusLabel: 'Cerrado',
    closedBy: 'Cerrado por',
    closedByVar: '{{ticket.closedBy}}',
    assignedTo: 'Asignado a',
    requester: 'Solicitante',
    board: 'Tablero',
    category: 'Categoría',
    location: 'Ubicación',
    resolutionLabel: 'Resolución',
    resolutionVar: '{{ticket.resolution}}',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Ticket Cerrado',
    textClosedBy: 'Cerrado por',
    textStatus: 'Estado',
    textClosedStatus: 'Cerrado',
    textAssigned: 'Asignado a',
    textRequester: 'Solicitante',
    textResolution: 'Resolución',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Ticket Geschlossen',
    intro: 'Ein Ticket wurde für <strong>{{ticket.clientName}}</strong> gelöst und geschlossen. Überprüfen Sie die Lösungsdetails unten.',
    badgePrefix: 'Ticket #',
    status: 'Status',
    closedStatusLabel: 'Geschlossen',
    closedBy: 'Geschlossen von',
    closedByVar: '{{ticket.closedBy}}',
    assignedTo: 'Zugewiesen an',
    requester: 'Anforderer',
    board: 'Board',
    category: 'Kategorie',
    location: 'Standort',
    resolutionLabel: 'Lösung',
    resolutionVar: '{{ticket.resolution}}',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Ticket Geschlossen',
    textClosedBy: 'Geschlossen von',
    textStatus: 'Status',
    textClosedStatus: 'Geschlossen',
    textAssigned: 'Zugewiesen an',
    textRequester: 'Anforderer',
    textResolution: 'Lösung',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Ticket Gesloten',
    intro: 'Een ticket is opgelost en gesloten voor <strong>{{ticket.clientName}}</strong>. Bekijk de oplossingsdetails hieronder.',
    badgePrefix: 'Ticket #',
    status: 'Status',
    closedStatusLabel: 'Gesloten',
    closedBy: 'Gesloten door',
    closedByVar: '{{ticket.closedBy}}',
    assignedTo: 'Toegewezen aan',
    requester: 'Aanvrager',
    board: 'Bord',
    category: 'Categorie',
    location: 'Locatie',
    resolutionLabel: 'Oplossing',
    resolutionVar: '{{ticket.resolution}}',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Ticket Gesloten',
    textClosedBy: 'Gesloten door',
    textStatus: 'Status',
    textClosedStatus: 'Gesloten',
    textAssigned: 'Toegewezen aan',
    textRequester: 'Aanvrager',
    textResolution: 'Oplossing',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Ticket chiuso',
    intro: 'È stato risolto e chiuso un ticket per <strong>{{ticket.clientName}}</strong>. Consulta i dettagli della risoluzione di seguito.',
    badgePrefix: 'Ticket #',
    status: 'Stato',
    closedStatusLabel: 'Chiuso',
    closedBy: 'Chiuso da',
    closedByVar: '{{ticket.closedBy}}',
    assignedTo: 'Assegnato a',
    requester: 'Richiedente',
    board: 'Board',
    category: 'Categoria',
    location: 'Sede',
    resolutionLabel: 'Risoluzione',
    resolutionVar: '{{ticket.resolution}}',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Ticket chiuso',
    textClosedBy: 'Chiuso da',
    textStatus: 'Stato',
    textClosedStatus: 'Chiuso',
    textAssigned: 'Assegnato a',
    textRequester: 'Richiedente',
    textResolution: 'Risoluzione',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Zgłoszenie zamknięte',
    intro: 'Zgłoszenie dla <strong>{{ticket.clientName}}</strong> zostało zamknięte. Poniżej znajdziesz podsumowanie.',
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    closedStatusLabel: 'Zamknięte',
    closedBy: 'Zamknięto',
    closedByVar: '{{ticket.closedAt}} &middot; {{ticket.closedBy}}',
    assignedTo: 'Przypisane do',
    requester: 'Zgłaszający',
    board: 'Tablica',
    category: 'Kategoria',
    location: 'Lokalizacja',
    resolutionLabel: 'Rozwiązanie',
    resolutionVar: '{{ticket.resolution}}',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Zgłoszenie zamknięte',
    textClosedBy: 'Zamknięto',
    textStatus: 'Status',
    textClosedStatus: '{{ticket.status}}',
    textAssigned: 'Przypisane do',
    textRequester: 'Zgłaszający',
    textResolution: 'Rozwiązanie',
    textView: 'Zobacz zgłoszenie',
    /* PL ticket-closed has priority row + different badge/color styling */
    hasPriority: true,
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  /* Priority row - most languages omit it for ticket-closed, PL includes it */
  const priorityRow = c.hasPriority
    ? `<tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.priority}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  `
    : '';

  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">${c.badgePrefix}{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  ${priorityRow}<tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.status}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:${BRAND_PRIMARY};color:#ffffff;font-weight:600;">${c.closedStatusLabel}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.closedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">${c.closedByVar}</td>
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
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.resolutionLabel}</div>
                  <div style="color:#475467;line-height:1.5;">${c.resolutionVar}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}
${c.textClosedBy}: {{ticket.closedBy}}

${c.textStatus}: ${c.textClosedStatus}
${c.textAssigned}: {{ticket.assignedDetails}}
${c.textRequester}: {{ticket.requesterDetails}}
${c.board}: {{ticket.board}}
${c.category}: {{ticket.categoryDetails}}
${c.location}: {{ticket.locationSummary}}

${c.textResolution}:
${c.resolutionVar}

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
