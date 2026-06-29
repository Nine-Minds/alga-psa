/**
 * Source-of-truth: ticket-created-client email template (client-facing).
 *
 * Sent to the primary client/contact (and external watchers) when a ticket is
 * created. Simplified counterpart of the MSP ticket-created template: keeps
 * the current status/priority, the assigned agent's name, and the ticket
 * description, but drops MSP-internal details (assignee email, requester
 * contact block, board/category/location rows, created-by line).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-created-client';
const SUBTYPE_NAME = 'Ticket Created Client';

const SUBJECTS = {
  en: 'Your Ticket Has Been Created • {{ticket.title}}',
  fr: 'Votre ticket a été créé • {{ticket.title}}',
  es: 'Su ticket ha sido creado • {{ticket.title}}',
  de: 'Ihr Ticket wurde erstellt • {{ticket.title}}',
  nl: 'Uw ticket is aangemaakt • {{ticket.title}}',
  it: 'Il suo ticket è stato creato • {{ticket.title}}',
  pl: 'Twoje zgłoszenie zostało utworzone • {{ticket.title}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Created',
    intro: 'Your ticket for <strong>{{ticket.clientName}}</strong> has been created. Our team will review it and follow up — you can track progress using the link below.',
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    assignedTo: 'Assigned To',
    descriptionLabel: 'Description',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Your Ticket Has Been Created',
    textDescription: 'Description',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Ticket Créé',
    intro: "Votre ticket pour <strong>{{ticket.clientName}}</strong> a été créé. Notre équipe va l'examiner et vous tiendra informé — vous pouvez suivre son avancement via le lien ci-dessous.",
    badgePrefix: 'Ticket #',
    priority: 'Priorité',
    status: 'Statut',
    assignedTo: 'Assigné à',
    descriptionLabel: 'Description',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Votre ticket a été créé',
    textDescription: 'Description',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Ticket Creado',
    intro: 'Su ticket para <strong>{{ticket.clientName}}</strong> ha sido creado. Nuestro equipo lo revisará y le mantendrá informado; puede seguir el progreso mediante el enlace a continuación.',
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    assignedTo: 'Asignado a',
    descriptionLabel: 'Descripción',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Su ticket ha sido creado',
    textDescription: 'Descripción',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Ticket Erstellt',
    intro: 'Ihr Ticket für <strong>{{ticket.clientName}}</strong> wurde erstellt. Unser Team wird es prüfen und sich bei Ihnen melden — über den untenstehenden Link können Sie den Fortschritt verfolgen.',
    badgePrefix: 'Ticket #',
    priority: 'Priorität',
    status: 'Status',
    assignedTo: 'Zugewiesen an',
    descriptionLabel: 'Beschreibung',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Ihr Ticket wurde erstellt',
    textDescription: 'Beschreibung',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Ticket Aangemaakt',
    intro: 'Uw ticket voor <strong>{{ticket.clientName}}</strong> is aangemaakt. Ons team bekijkt het en houdt u op de hoogte — via de onderstaande link kunt u de voortgang volgen.',
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    assignedTo: 'Toegewezen aan',
    descriptionLabel: 'Beschrijving',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Uw ticket is aangemaakt',
    textDescription: 'Beschrijving',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Ticket creato',
    intro: 'Il suo ticket per <strong>{{ticket.clientName}}</strong> è stato creato. Il nostro team lo esaminerà e la terrà aggiornata — può seguire i progressi tramite il link qui sotto.',
    badgePrefix: 'Ticket #',
    priority: 'Priorità',
    status: 'Stato',
    assignedTo: 'Assegnato a',
    descriptionLabel: 'Descrizione',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Il suo ticket è stato creato',
    textDescription: 'Descrizione',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Nowe zgłoszenie',
    intro: 'Twoje zgłoszenie dla <strong>{{ticket.clientName}}</strong> zostało utworzone. Nasz zespół zajmie się nim wkrótce — postęp możesz śledzić, korzystając z poniższego linku.',
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    assignedTo: 'Przypisane do',
    descriptionLabel: 'Opis',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Twoje zgłoszenie zostało utworzone',
    textDescription: 'Opis',
    textView: 'Zobacz zgłoszenie',
  },
};
SUBJECTS.pt = 'Seu chamado foi criado • {{ticket.title}}';
COPY.pt = {
  headerLabel: 'Chamado criado',
  intro: 'Seu chamado para <strong>{{ticket.clientName}}</strong> foi criado. Nossa equipe vai analisá-lo e retornar — você pode acompanhar o progresso pelo link abaixo.',
  badgePrefix: 'Chamado #',
  priority: 'Prioridade',
  status: 'Status',
  assignedTo: 'Atribuído a',
  descriptionLabel: 'Descrição',
  viewButton: 'Ver chamado',
  footer: 'Powered by Alga PSA &middot; Mantendo as equipes alinhadas',
  textHeader: 'Seu chamado foi criado',
  textDescription: 'Descrição',
  textView: 'Ver chamado',
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
                    <td style="padding:12px 0;font-weight:600;color:#475467;">${c.assignedTo}</td>
                    <td style="padding:12px 0;">{{ticket.assignedToName}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${INFO_BOX_BG};border:1px solid ${INFO_BOX_BORDER};">
                  <div style="font-weight:600;color:${BRAND_DARK};margin-bottom:8px;">${c.descriptionLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.assignedTo}: {{ticket.assignedToName}}

${c.textDescription}:
{{ticket.description}}

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
