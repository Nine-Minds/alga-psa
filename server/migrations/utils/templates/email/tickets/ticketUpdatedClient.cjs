/**
 * Source-of-truth: ticket-updated-client email template (client-facing).
 *
 * Sent to the primary client/contact (and external watchers) when a ticket is
 * updated. Simplified counterpart of the MSP ticket-updated template: keeps
 * the current status/priority, the assigned agent's name, and the change
 * summary, but drops MSP-internal details (assignee email, requester contact
 * block, board/category/location rows).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const {
  BADGE_BG,
  BRAND_DARK,
  BRAND_PRIMARY,
} = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'ticket-updated-client';
const SUBTYPE_NAME = 'Ticket Updated Client';

const SUBJECTS = {
  en: 'Your Ticket Was Updated • {{ticket.title}}',
  fr: 'Votre ticket a été mis à jour • {{ticket.title}}',
  es: 'Su ticket ha sido actualizado • {{ticket.title}}',
  de: 'Ihr Ticket wurde aktualisiert • {{ticket.title}}',
  nl: 'Uw ticket is bijgewerkt • {{ticket.title}}',
  it: 'Il suo ticket è stato aggiornato • {{ticket.title}}',
  pl: 'Twoje zgłoszenie zostało zaktualizowane • {{ticket.title}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Updated',
    intro: 'Your ticket for <strong>{{ticket.clientName}}</strong> has been updated. Here is a summary of the changes.',
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    assignedTo: 'Assigned To',
    changesLabel: 'What Changed',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Your Ticket Was Updated',
    textChanges: 'What Changed',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Ticket Mis à Jour',
    intro: 'Votre ticket pour <strong>{{ticket.clientName}}</strong> a été mis à jour. Voici un résumé des modifications.',
    badgePrefix: 'Ticket #',
    priority: 'Priorité',
    status: 'Statut',
    assignedTo: 'Assigné à',
    changesLabel: 'Modifications',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Votre ticket a été mis à jour',
    textChanges: 'Modifications',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Ticket Actualizado',
    intro: 'Su ticket para <strong>{{ticket.clientName}}</strong> ha sido actualizado. A continuación encontrará un resumen de los cambios.',
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    assignedTo: 'Asignado a',
    changesLabel: 'Cambios Realizados',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Su ticket ha sido actualizado',
    textChanges: 'Cambios realizados',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Ticket Aktualisiert',
    intro: 'Ihr Ticket für <strong>{{ticket.clientName}}</strong> wurde aktualisiert. Nachfolgend finden Sie eine Zusammenfassung der Änderungen.',
    badgePrefix: 'Ticket #',
    priority: 'Priorität',
    status: 'Status',
    assignedTo: 'Zugewiesen an',
    changesLabel: 'Änderungen',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Ihr Ticket wurde aktualisiert',
    textChanges: 'Änderungen',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Ticket Bijgewerkt',
    intro: 'Uw ticket voor <strong>{{ticket.clientName}}</strong> is bijgewerkt. Hieronder vindt u een samenvatting van de wijzigingen.',
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    assignedTo: 'Toegewezen aan',
    changesLabel: 'Wijzigingen',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Uw ticket is bijgewerkt',
    textChanges: 'Wijzigingen',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Ticket aggiornato',
    intro: 'Il suo ticket per <strong>{{ticket.clientName}}</strong> è stato aggiornato. Di seguito un riepilogo delle modifiche.',
    badgePrefix: 'Ticket #',
    priority: 'Priorità',
    status: 'Stato',
    assignedTo: 'Assegnato a',
    changesLabel: 'Modifiche effettuate',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Il suo ticket è stato aggiornato',
    textChanges: 'Modifiche effettuate',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Zgłoszenie zaktualizowane',
    intro: 'Twoje zgłoszenie dla <strong>{{ticket.clientName}}</strong> zostało zaktualizowane. Poniżej znajdziesz podsumowanie zmian.',
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    assignedTo: 'Przypisane do',
    changesLabel: 'Zmiany',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Twoje zgłoszenie zostało zaktualizowane',
    textChanges: 'Zmiany',
    textView: 'Zobacz zgłoszenie',
  },
};
/* eslint-enable max-len */

const CHANGES_BOX_BG = '#fff9e6';
const CHANGES_BOX_BORDER = '#ffe4a3';
const CHANGES_LABEL_COLOR = '#92400e';

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
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${CHANGES_BOX_BG};border:1px solid ${CHANGES_BOX_BORDER};">
                  <div style="font-weight:600;color:${CHANGES_LABEL_COLOR};margin-bottom:8px;">${c.changesLabel}</div>
                  <div style="color:#475467;line-height:1.5;">{{{ticket.changes}}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.assignedTo}: {{ticket.assignedToName}}

${c.textChanges}:
{{{ticket.changes}}}

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
