/**
 * Source-of-truth: ticket-assigned email template.
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

const TEMPLATE_NAME = 'ticket-assigned';
const SUBTYPE_NAME = 'Ticket Assigned';

const SUBJECTS = {
  en: 'Ticket Assigned • {{ticket.title}} ({{ticket.priority}})',
  fr: 'Ticket Assigné • {{ticket.title}} ({{ticket.priority}})',
  es: 'Ticket Asignado • {{ticket.title}} ({{ticket.priority}})',
  de: 'Ticket Zugewiesen • {{ticket.title}} ({{ticket.priority}})',
  nl: 'Ticket Toegewezen • {{ticket.title}} ({{ticket.priority}})',
  it: 'Ticket assegnato • {{ticket.title}} ({{ticket.priority}})',
  pl: 'Zgłoszenie przypisane • {{ticket.title}} ({{ticket.priority}})',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Assigned',
    intro: 'You have been assigned to a ticket for <strong>{{ticket.clientName}}</strong>. Review the details below and take action.',
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    assignedBy: 'Assigned By',
    assignedTo: 'Assigned To',
    requester: 'Requester',
    board: 'Board',
    category: 'Category',
    location: 'Location',
    descriptionLabel: 'Description',
    descriptionVar: '{{{ticket.description}}}',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Ticket Assigned to You',
    textAssignedBy: 'Assigned By',
    textAssigned: 'Assigned To',
    textRequester: 'Requester',
    textDescription: 'Description',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Ticket Assigné',
    intro: 'Ce ticket vous a été assigné pour <strong>{{ticket.clientName}}</strong>. Consultez les détails ci-dessous et prenez les mesures appropriées.',
    badgePrefix: 'Ticket #',
    priority: 'Priorité',
    status: 'Statut',
    assignedBy: 'Assigné par',
    assignedTo: 'Assigné à',
    requester: 'Demandeur',
    board: 'Tableau',
    category: 'Catégorie',
    location: 'Emplacement',
    descriptionLabel: 'Description',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Ticket Assigné à Vous',
    textAssignedBy: 'Assigné par',
    textAssigned: 'Assigné à',
    textRequester: 'Demandeur',
    textDescription: 'Description',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Ticket Asignado',
    intro: 'Se te ha asignado un ticket para <strong>{{ticket.clientName}}</strong>. Revisa los detalles a continuación y toma acción.',
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    assignedBy: 'Asignado por',
    assignedTo: 'Asignado a',
    requester: 'Solicitante',
    board: 'Tablero',
    category: 'Categoría',
    location: 'Ubicación',
    descriptionLabel: 'Descripción',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Ticket Asignado a Ti',
    textAssignedBy: 'Asignado por',
    textAssigned: 'Asignado a',
    textRequester: 'Solicitante',
    textDescription: 'Descripción',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Ticket Zugewiesen',
    intro: 'Dieses Ticket wurde Ihnen für <strong>{{ticket.clientName}}</strong> zugewiesen. Überprüfen Sie die Details unten und ergreifen Sie Maßnahmen.',
    badgePrefix: 'Ticket #',
    priority: 'Priorität',
    status: 'Status',
    assignedBy: 'Zugewiesen von',
    assignedTo: 'Zugewiesen an',
    requester: 'Anforderer',
    board: 'Board',
    category: 'Kategorie',
    location: 'Standort',
    descriptionLabel: 'Beschreibung',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Ticket Zugewiesen an Sie',
    textAssignedBy: 'Zugewiesen von',
    textAssigned: 'Zugewiesen an',
    textRequester: 'Anforderer',
    textDescription: 'Beschreibung',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Ticket Toegewezen',
    intro: 'Dit ticket is aan u toegewezen voor <strong>{{ticket.clientName}}</strong>. Bekijk de details hieronder en onderneem actie.',
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    assignedBy: 'Toegewezen door',
    assignedTo: 'Toegewezen aan',
    requester: 'Aanvrager',
    board: 'Bord',
    category: 'Categorie',
    location: 'Locatie',
    descriptionLabel: 'Beschrijving',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Ticket Toegewezen aan U',
    textAssignedBy: 'Toegewezen door',
    textAssigned: 'Toegewezen aan',
    textRequester: 'Aanvrager',
    textDescription: 'Beschrijving',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Ticket assegnato',
    intro: 'Ti è stato assegnato un ticket per <strong>{{ticket.clientName}}</strong>. Consulta i dettagli qui sotto e procedi con le attività necessarie.',
    badgePrefix: 'Ticket #',
    priority: 'Priorità',
    status: 'Stato',
    assignedBy: 'Assegnato da',
    assignedTo: 'Assegnato a',
    requester: 'Richiedente',
    board: 'Board',
    category: 'Categoria',
    location: 'Sede',
    descriptionLabel: 'Descrizione',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Ticket assegnato a te',
    textAssignedBy: 'Assegnato da',
    textAssigned: 'Assegnato a',
    textRequester: 'Richiedente',
    textDescription: 'Descrizione',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Zgłoszenie przypisane',
    intro: 'To zgłoszenie zostało do Ciebie przypisane dla <strong>{{ticket.clientName}}</strong>. Sprawdź szczegóły poniżej i podejmij odpowiednie działania.',
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    assignedBy: 'Przypisał(a)',
    assignedTo: 'Przypisane do',
    requester: 'Zgłaszający',
    board: 'Tablica',
    category: 'Kategoria',
    location: 'Lokalizacja',
    descriptionLabel: 'Podsumowanie zgłoszenia',
    descriptionVar: '{{ticket.summary}}',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Zgłoszenie przypisane',
    textAssignedBy: 'Przypisał(a)',
    textAssigned: 'Przypisane do',
    textRequester: 'Zgłaszający',
    textDescription: 'Podsumowanie',
    textView: 'Zobacz zgłoszenie',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.assignedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
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
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.descriptionLabel}</div>
                  <div style="color:#475467;line-height:1.5;">${c.descriptionVar}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}
${c.textAssignedBy}: {{ticket.assignedBy}}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.textAssigned}: {{ticket.assignedDetails}}
${c.textRequester}: {{ticket.requesterDetails}}
${c.board}: {{ticket.board}}
${c.category}: {{ticket.categoryDetails}}
${c.location}: {{ticket.locationSummary}}

${c.textDescription}:
${c.descriptionVar}

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
