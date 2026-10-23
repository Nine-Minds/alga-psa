/**
 * Source-of-truth: ticket-board-status-entered email template.
 *
 * Sent to internal users selected by a board notification rule when a ticket
 * enters a watched status. Built on the ticket-created body (same context
 * variables) with two extra rows: {{ticket.enteredStatus}} and
 * {{ticket.previousStatus}}.
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { COPY: BASE_COPY, buildBodyHtml, buildText } = require('./ticketCreated.cjs');

const TEMPLATE_NAME = 'ticket-board-status-entered';
const SUBTYPE_NAME = 'Board Ticket Status Entered';

/* eslint-disable max-len */
const LOCALIZED = {
  en: {
    subject: 'Ticket Entered {{ticket.enteredStatus}} on {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ticket Entered Status',
    intro: 'A ticket for <strong>{{ticket.clientName}}</strong> on the <strong>{{ticket.board}}</strong> board has entered the <strong>{{ticket.enteredStatus}}</strong> status. You are receiving this because of a notification rule for this board.',
    textHeader: 'Ticket entered {{ticket.enteredStatus}} on {{ticket.board}} for {{ticket.clientName}}',
    enteredStatus: 'New Status',
    previousStatus: 'Previous Status',
  },
  fr: {
    subject: 'Ticket passé à {{ticket.enteredStatus}} sur {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ticket passé à un statut',
    intro: 'Un ticket pour <strong>{{ticket.clientName}}</strong> sur le tableau <strong>{{ticket.board}}</strong> est passé au statut <strong>{{ticket.enteredStatus}}</strong>. Vous recevez ce message en raison d\'une règle de notification pour ce tableau.',
    textHeader: 'Ticket passé à {{ticket.enteredStatus}} sur {{ticket.board}} pour {{ticket.clientName}}',
    enteredStatus: 'Nouveau statut',
    previousStatus: 'Statut précédent',
  },
  es: {
    subject: 'Ticket pasó a {{ticket.enteredStatus}} en {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ticket cambió de estado',
    intro: 'Un ticket de <strong>{{ticket.clientName}}</strong> en el tablero <strong>{{ticket.board}}</strong> ha pasado al estado <strong>{{ticket.enteredStatus}}</strong>. Recibes este mensaje por una regla de notificación de este tablero.',
    textHeader: 'Ticket pasó a {{ticket.enteredStatus}} en {{ticket.board}} para {{ticket.clientName}}',
    enteredStatus: 'Nuevo estado',
    previousStatus: 'Estado anterior',
  },
  de: {
    subject: 'Ticket ist nun {{ticket.enteredStatus}} auf {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ticket hat Status erreicht',
    intro: 'Ein Ticket für <strong>{{ticket.clientName}}</strong> auf dem Board <strong>{{ticket.board}}</strong> hat den Status <strong>{{ticket.enteredStatus}}</strong> erreicht. Sie erhalten diese Nachricht aufgrund einer Benachrichtigungsregel für dieses Board.',
    textHeader: 'Ticket hat Status {{ticket.enteredStatus}} auf {{ticket.board}} für {{ticket.clientName}} erreicht',
    enteredStatus: 'Neuer Status',
    previousStatus: 'Vorheriger Status',
  },
  nl: {
    subject: 'Ticket is nu {{ticket.enteredStatus}} op {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ticket heeft status bereikt',
    intro: 'Een ticket voor <strong>{{ticket.clientName}}</strong> op het bord <strong>{{ticket.board}}</strong> heeft de status <strong>{{ticket.enteredStatus}}</strong> bereikt. U ontvangt dit bericht vanwege een meldingsregel voor dit bord.',
    textHeader: 'Ticket heeft status {{ticket.enteredStatus}} bereikt op {{ticket.board}} voor {{ticket.clientName}}',
    enteredStatus: 'Nieuwe status',
    previousStatus: 'Vorige status',
  },
  it: {
    subject: 'Ticket passato a {{ticket.enteredStatus}} su {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ticket passato a uno stato',
    intro: 'Un ticket per <strong>{{ticket.clientName}}</strong> sulla bacheca <strong>{{ticket.board}}</strong> è passato allo stato <strong>{{ticket.enteredStatus}}</strong>. Ricevi questo messaggio a causa di una regola di notifica per questa bacheca.',
    textHeader: 'Ticket passato a {{ticket.enteredStatus}} su {{ticket.board}} per {{ticket.clientName}}',
    enteredStatus: 'Nuovo stato',
    previousStatus: 'Stato precedente',
  },
  pl: {
    subject: 'Zgłoszenie weszło w status {{ticket.enteredStatus}} na tablicy {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Zgłoszenie zmieniło status',
    intro: 'Zgłoszenie dla <strong>{{ticket.clientName}}</strong> na tablicy <strong>{{ticket.board}}</strong> weszło w status <strong>{{ticket.enteredStatus}}</strong>. Otrzymujesz tę wiadomość z powodu reguły powiadomień dla tej tablicy.',
    textHeader: 'Zgłoszenie weszło w status {{ticket.enteredStatus}} na tablicy {{ticket.board}} dla {{ticket.clientName}}',
    enteredStatus: 'Nowy status',
    previousStatus: 'Poprzedni status',
  },
  pt: {
    subject: 'Ticket entrou em {{ticket.enteredStatus}} em {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ticket mudou de status',
    intro: 'Um ticket de <strong>{{ticket.clientName}}</strong> no quadro <strong>{{ticket.board}}</strong> entrou no status <strong>{{ticket.enteredStatus}}</strong>. Você está recebendo esta mensagem por causa de uma regra de notificação deste quadro.',
    textHeader: 'Ticket entrou em {{ticket.enteredStatus}} em {{ticket.board}} para {{ticket.clientName}}',
    enteredStatus: 'Novo status',
    previousStatus: 'Status anterior',
  },
  sv: {
    subject: 'Ärende har fått status {{ticket.enteredStatus}} på {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Ärende har bytt status',
    intro: 'Ett ärende för <strong>{{ticket.clientName}}</strong> på tavlan <strong>{{ticket.board}}</strong> har fått statusen <strong>{{ticket.enteredStatus}}</strong>. Du får detta meddelande på grund av en aviseringsregel för tavlan.',
    textHeader: 'Ärende har fått status {{ticket.enteredStatus}} på {{ticket.board}} för {{ticket.clientName}}',
    enteredStatus: 'Ny status',
    previousStatus: 'Tidigare status',
  },
};
/* eslint-enable max-len */

function statusRows(loc) {
  const row = (label, variable) => `
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${label}</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">${variable}</td>
                  </tr>`;
  return row(loc.enteredStatus, '{{ticket.enteredStatus}}') + row(loc.previousStatus, '{{ticket.previousStatus}}');
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(LOCALIZED).map(([lang, loc]) => {
      const copy = {
        ...BASE_COPY[lang],
        ...loc,
        extraRowsHtml: statusRows(loc),
        extraText: `${loc.enteredStatus}: {{ticket.enteredStatus}}\n${loc.previousStatus}: {{ticket.previousStatus}}\n`,
      };
      return {
        language: lang,
        subject: loc.subject,
        htmlContent: wrapEmailLayout({
          language: lang,
          headerLabel: copy.headerLabel,
          headerTitle: '{{ticket.title}}',
          headerMeta: '{{ticket.metaLine}}',
          bodyHtml: buildBodyHtml(copy),
          footerText: copy.footer,
        }),
        textContent: buildText(copy),
      };
    }),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
