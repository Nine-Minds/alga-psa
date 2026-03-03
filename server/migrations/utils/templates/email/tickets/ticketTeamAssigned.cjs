/**
 * Source-of-truth: ticket-team-assigned email template (client-facing).
 *
 * Sent to the client/contact when a team is assigned to their ticket.
 * Uses the shared email layout wrapper.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-team-assigned';
const SUBTYPE_NAME = 'Ticket Team Assigned';

const SUBJECTS = {
  en: 'Team Assigned to Your Ticket • {{ticket.title}}',
  fr: 'Équipe assignée à votre ticket • {{ticket.title}}',
  es: 'Equipo asignado a su ticket • {{ticket.title}}',
  de: 'Team Ihrem Ticket zugewiesen • {{ticket.title}}',
  nl: 'Team toegewezen aan uw ticket • {{ticket.title}}',
  it: 'Team assegnato al suo ticket • {{ticket.title}}',
  pl: 'Zespół przypisany do Twojego zgłoszenia • {{ticket.title}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Team Assigned',
    intro: "Team <strong>{{ticket.teamName}}</strong> has been assigned to your ticket for <strong>{{ticket.clientName}}</strong>. Our team is reviewing your request and will respond shortly.",
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    team: 'Assigned Team',
    assignedBy: 'Assigned By',
    requester: 'Requester',
    board: 'Board',
    category: 'Category',
    location: 'Location',
    descriptionLabel: 'Description',
    descriptionVar: '{{{ticket.description}}}',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Team Assigned to Your Ticket',
    textTeam: 'Assigned Team',
    textAssignedBy: 'Assigned By',
    textRequester: 'Requester',
    textDescription: 'Description',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Équipe Assignée',
    intro: "L'équipe <strong>{{ticket.teamName}}</strong> a été assignée à votre ticket pour <strong>{{ticket.clientName}}</strong>. Notre équipe examine votre demande et vous répondra bientôt.",
    badgePrefix: 'Ticket #',
    priority: 'Priorité',
    status: 'Statut',
    team: 'Équipe assignée',
    assignedBy: 'Assigné par',
    requester: 'Demandeur',
    board: 'Tableau',
    category: 'Catégorie',
    location: 'Emplacement',
    descriptionLabel: 'Description',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Équipe assignée à votre ticket',
    textTeam: 'Équipe assignée',
    textAssignedBy: 'Assigné par',
    textRequester: 'Demandeur',
    textDescription: 'Description',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Equipo Asignado',
    intro: "El equipo <strong>{{ticket.teamName}}</strong> ha sido asignado a su ticket para <strong>{{ticket.clientName}}</strong>. Nuestro equipo está revisando su solicitud y responderá pronto.",
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    team: 'Equipo asignado',
    assignedBy: 'Asignado por',
    requester: 'Solicitante',
    board: 'Tablero',
    category: 'Categoría',
    location: 'Ubicación',
    descriptionLabel: 'Descripción',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Equipo asignado a su ticket',
    textTeam: 'Equipo asignado',
    textAssignedBy: 'Asignado por',
    textRequester: 'Solicitante',
    textDescription: 'Descripción',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Team Zugewiesen',
    intro: "Team <strong>{{ticket.teamName}}</strong> wurde Ihrem Ticket für <strong>{{ticket.clientName}}</strong> zugewiesen. Unser Team überprüft Ihre Anfrage und wird sich in Kürze melden.",
    badgePrefix: 'Ticket #',
    priority: 'Priorität',
    status: 'Status',
    team: 'Zugewiesenes Team',
    assignedBy: 'Zugewiesen von',
    requester: 'Anforderer',
    board: 'Board',
    category: 'Kategorie',
    location: 'Standort',
    descriptionLabel: 'Beschreibung',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Team Ihrem Ticket zugewiesen',
    textTeam: 'Zugewiesenes Team',
    textAssignedBy: 'Zugewiesen von',
    textRequester: 'Anforderer',
    textDescription: 'Beschreibung',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Team Toegewezen',
    intro: "Team <strong>{{ticket.teamName}}</strong> is toegewezen aan uw ticket voor <strong>{{ticket.clientName}}</strong>. Ons team bekijkt uw verzoek en reageert spoedig.",
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    team: 'Toegewezen team',
    assignedBy: 'Toegewezen door',
    requester: 'Aanvrager',
    board: 'Bord',
    category: 'Categorie',
    location: 'Locatie',
    descriptionLabel: 'Beschrijving',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Team toegewezen aan uw ticket',
    textTeam: 'Toegewezen team',
    textAssignedBy: 'Toegewezen door',
    textRequester: 'Aanvrager',
    textDescription: 'Beschrijving',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Team Assegnato',
    intro: "Il team <strong>{{ticket.teamName}}</strong> è stato assegnato al suo ticket per <strong>{{ticket.clientName}}</strong>. Il nostro team sta esaminando la sua richiesta e risponderà a breve.",
    badgePrefix: 'Ticket #',
    priority: 'Priorità',
    status: 'Stato',
    team: 'Team assegnato',
    assignedBy: 'Assegnato da',
    requester: 'Richiedente',
    board: 'Board',
    category: 'Categoria',
    location: 'Sede',
    descriptionLabel: 'Descrizione',
    descriptionVar: '{{ticket.description}}',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Team assegnato al suo ticket',
    textTeam: 'Team assegnato',
    textAssignedBy: 'Assegnato da',
    textRequester: 'Richiedente',
    textDescription: 'Descrizione',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Zespół Przypisany',
    intro: "Zespół <strong>{{ticket.teamName}}</strong> został przypisany do Twojego zgłoszenia dla <strong>{{ticket.clientName}}</strong>. Nasz zespół analizuje Twoje zgłoszenie i wkrótce odpowie.",
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    team: 'Przypisany zespół',
    assignedBy: 'Przypisał(a)',
    requester: 'Zgłaszający',
    board: 'Tablica',
    category: 'Kategoria',
    location: 'Lokalizacja',
    descriptionLabel: 'Podsumowanie zgłoszenia',
    descriptionVar: '{{ticket.summary}}',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Zespół przypisany do Twojego zgłoszenia',
    textTeam: 'Przypisany zespół',
    textAssignedBy: 'Przypisał(a)',
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.team}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;">{{ticket.teamName}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.assignedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
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
${c.textTeam}: {{ticket.teamName}}
${c.textAssignedBy}: {{ticket.assignedBy}}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
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
