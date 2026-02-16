/**
 * Source-of-truth: ticket-updated email template.
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

const TEMPLATE_NAME = 'ticket-updated';
const SUBTYPE_NAME = 'Ticket Updated';

const SUBJECTS = {
  en: 'Ticket Updated • {{ticket.title}} ({{ticket.priority}})',
  fr: 'Ticket Mis à Jour • {{ticket.title}} ({{ticket.priority}})',
  es: 'Ticket Actualizado • {{ticket.title}} ({{ticket.priority}})',
  de: 'Ticket Aktualisiert • {{ticket.title}} ({{ticket.priority}})',
  nl: 'Ticket Bijgewerkt • {{ticket.title}} ({{ticket.priority}})',
  it: 'Ticket aggiornato • {{ticket.title}} ({{ticket.priority}})',
  pl: 'Zgłoszenie zaktualizowane • {{ticket.title}} ({{ticket.priority}})',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Updated',
    intro: 'A ticket for <strong>{{ticket.clientName}}</strong> has been updated. Review the changes below.',
    badgePrefix: 'Ticket #',
    priority: 'Priority',
    status: 'Status',
    updatedBy: 'Updated By',
    assignedTo: 'Assigned To',
    requester: 'Requester',
    board: 'Board',
    category: 'Category',
    location: 'Location',
    changesLabel: 'Changes Made',
    changesVar: '{{{ticket.changes}}}',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'Ticket Updated',
    textUpdatedBy: 'Updated By',
    textAssigned: 'Assigned To',
    textRequester: 'Requester',
    textChanges: 'Changes Made',
    textView: 'View ticket',
  },
  fr: {
    headerLabel: 'Ticket Mis à Jour',
    intro: 'Un ticket a été mis à jour pour <strong>{{ticket.clientName}}</strong>. Consultez les modifications ci-dessous.',
    badgePrefix: 'Ticket #',
    priority: 'Priorité',
    status: 'Statut',
    updatedBy: 'Mis à jour par',
    assignedTo: 'Assigné à',
    requester: 'Demandeur',
    board: 'Tableau',
    category: 'Catégorie',
    location: 'Emplacement',
    changesLabel: 'Modifications',
    changesVar: '{{ticket.changes}}',
    viewButton: 'Voir le Ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les équipes alignées',
    textHeader: 'Ticket Mis à Jour',
    textUpdatedBy: 'Mis à jour par',
    textAssigned: 'Assigné à',
    textRequester: 'Demandeur',
    textChanges: 'Modifications',
    textView: 'Voir le ticket',
  },
  es: {
    headerLabel: 'Ticket Actualizado',
    intro: 'Se ha actualizado un ticket para <strong>{{ticket.clientName}}</strong>. Revisa los cambios a continuación.',
    badgePrefix: 'Ticket #',
    priority: 'Prioridad',
    status: 'Estado',
    updatedBy: 'Actualizado por',
    assignedTo: 'Asignado a',
    requester: 'Solicitante',
    board: 'Tablero',
    category: 'Categoría',
    location: 'Ubicación',
    changesLabel: 'Cambios Realizados',
    changesVar: '{{ticket.changes}}',
    viewButton: 'Ver Ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'Ticket Actualizado',
    textUpdatedBy: 'Actualizado por',
    textAssigned: 'Asignado a',
    textRequester: 'Solicitante',
    textChanges: 'Cambios realizados',
    textView: 'Ver ticket',
  },
  de: {
    headerLabel: 'Ticket Aktualisiert',
    intro: 'Ein Ticket wurde für <strong>{{ticket.clientName}}</strong> aktualisiert. Überprüfen Sie die Änderungen unten.',
    badgePrefix: 'Ticket #',
    priority: 'Priorität',
    status: 'Status',
    updatedBy: 'Aktualisiert von',
    assignedTo: 'Zugewiesen an',
    requester: 'Anforderer',
    board: 'Board',
    category: 'Kategorie',
    location: 'Standort',
    changesLabel: 'Änderungen',
    changesVar: '{{ticket.changes}}',
    viewButton: 'Ticket Anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'Ticket Aktualisiert',
    textUpdatedBy: 'Aktualisiert von',
    textAssigned: 'Zugewiesen an',
    textRequester: 'Anforderer',
    textChanges: 'Änderungen',
    textView: 'Ticket anzeigen',
  },
  nl: {
    headerLabel: 'Ticket Bijgewerkt',
    intro: 'Een ticket is bijgewerkt voor <strong>{{ticket.clientName}}</strong>. Bekijk de wijzigingen hieronder.',
    badgePrefix: 'Ticket #',
    priority: 'Prioriteit',
    status: 'Status',
    updatedBy: 'Bijgewerkt door',
    assignedTo: 'Toegewezen aan',
    requester: 'Aanvrager',
    board: 'Bord',
    category: 'Categorie',
    location: 'Locatie',
    changesLabel: 'Wijzigingen',
    changesVar: '{{ticket.changes}}',
    viewButton: 'Ticket Bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op één lijn houden',
    textHeader: 'Ticket Bijgewerkt',
    textUpdatedBy: 'Bijgewerkt door',
    textAssigned: 'Toegewezen aan',
    textRequester: 'Aanvrager',
    textChanges: 'Wijzigingen',
    textView: 'Ticket bekijken',
  },
  it: {
    headerLabel: 'Ticket aggiornato',
    intro: 'È stato aggiornato un ticket per <strong>{{ticket.clientName}}</strong>. Consulta le modifiche riportate qui sotto.',
    badgePrefix: 'Ticket #',
    priority: 'Priorità',
    status: 'Stato',
    updatedBy: 'Aggiornato da',
    assignedTo: 'Assegnato a',
    requester: 'Richiedente',
    board: 'Board',
    category: 'Categoria',
    location: 'Sede',
    changesLabel: 'Modifiche effettuate',
    changesVar: '{{ticket.changes}}',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'Ticket aggiornato',
    textUpdatedBy: 'Aggiornato da',
    textAssigned: 'Assegnato a',
    textRequester: 'Richiedente',
    textChanges: 'Modifiche effettuate',
    textView: 'Apri ticket',
  },
  pl: {
    headerLabel: 'Zgłoszenie zaktualizowane',
    intro: 'Zgłoszenie dla <strong>{{ticket.clientName}}</strong> zostało zaktualizowane. Sprawdź szczegóły i podejmij działania.',
    badgePrefix: 'Zgłoszenie #',
    priority: 'Priorytet',
    status: 'Status',
    updatedBy: 'Zaktualizowano',
    assignedTo: 'Przypisane do',
    requester: 'Zgłaszający',
    board: 'Tablica',
    category: 'Kategoria',
    location: 'Lokalizacja',
    changesLabel: 'Podsumowanie zgłoszenia',
    changesVar: '{{ticket.summary}}',
    viewButton: 'Zobacz zgłoszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'Zgłoszenie zaktualizowane',
    textUpdatedBy: 'Zaktualizowano',
    textAssigned: 'Przypisane do',
    textRequester: 'Zgłaszający',
    textChanges: 'Podsumowanie',
    textView: 'Zobacz zgłoszenie',
    /* PL uses {{ticket.updatedAt}} · {{ticket.updatedBy}} in the "Updated By" row */
    updatedByVar: '{{ticket.updatedAt}} &middot; {{ticket.updatedBy}}',
  },
};
/* eslint-enable max-len */

const CHANGES_BOX_BG = '#fff9e6';
const CHANGES_BOX_BORDER = '#ffe4a3';
const CHANGES_LABEL_COLOR = '#92400e';

function buildBodyHtml(c) {
  const updatedByVal = c.updatedByVar || '{{ticket.updatedBy}}';
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.updatedBy}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">${updatedByVal}</td>
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
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:${CHANGES_BOX_BG};border:1px solid ${CHANGES_BOX_BORDER};">
                  <div style="font-weight:600;color:${CHANGES_LABEL_COLOR};margin-bottom:8px;">${c.changesLabel}</div>
                  <div style="color:#475467;line-height:1.5;">${c.changesVar}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${c.viewButton}</a>`;
}

function buildText(c) {
  return `${c.textHeader}

{{ticket.metaLine}}
${c.textUpdatedBy}: {{ticket.updatedBy}}

${c.priority}: {{ticket.priority}}
${c.status}: {{ticket.status}}
${c.textAssigned}: {{ticket.assignedDetails}}
${c.textRequester}: {{ticket.requesterDetails}}
${c.board}: {{ticket.board}}
${c.category}: {{ticket.categoryDetails}}
${c.location}: {{ticket.locationSummary}}

${c.textChanges}:
${c.changesVar}

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
