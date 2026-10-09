/**
 * Source-of-truth: ticket-board-created email template.
 *
 * Sent to internal users selected by a board notification rule when a new
 * ticket is created on the board. Built on the ticket-created body so the
 * context variables are identical (ticket.board, ticket.url, ...).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { COPY: BASE_COPY, buildBodyHtml, buildText } = require('./ticketCreated.cjs');

const TEMPLATE_NAME = 'ticket-board-created';
const SUBTYPE_NAME = 'Board Ticket Created';

/* eslint-disable max-len */
const LOCALIZED = {
  en: {
    subject: 'New Ticket on {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'New Ticket on Board',
    intro: 'A new ticket has been logged on the <strong>{{ticket.board}}</strong> board for <strong>{{ticket.clientName}}</strong>. You are receiving this because of a notification rule for this board.',
    textHeader: 'New Ticket on {{ticket.board}} for {{ticket.clientName}}',
  },
  fr: {
    subject: 'Nouveau ticket sur {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Nouveau ticket sur le tableau',
    intro: 'Un nouveau ticket a été enregistré sur le tableau <strong>{{ticket.board}}</strong> pour <strong>{{ticket.clientName}}</strong>. Vous recevez ce message en raison d\'une règle de notification pour ce tableau.',
    textHeader: 'Nouveau ticket sur {{ticket.board}} pour {{ticket.clientName}}',
  },
  es: {
    subject: 'Nuevo ticket en {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Nuevo ticket en el tablero',
    intro: 'Se ha registrado un nuevo ticket en el tablero <strong>{{ticket.board}}</strong> para <strong>{{ticket.clientName}}</strong>. Recibes este mensaje por una regla de notificación de este tablero.',
    textHeader: 'Nuevo ticket en {{ticket.board}} para {{ticket.clientName}}',
  },
  de: {
    subject: 'Neues Ticket auf {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Neues Ticket auf dem Board',
    intro: 'Auf dem Board <strong>{{ticket.board}}</strong> wurde ein neues Ticket für <strong>{{ticket.clientName}}</strong> registriert. Sie erhalten diese Nachricht aufgrund einer Benachrichtigungsregel für dieses Board.',
    textHeader: 'Neues Ticket auf {{ticket.board}} für {{ticket.clientName}}',
  },
  nl: {
    subject: 'Nieuw ticket op {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Nieuw ticket op bord',
    intro: 'Er is een nieuw ticket geregistreerd op het bord <strong>{{ticket.board}}</strong> voor <strong>{{ticket.clientName}}</strong>. U ontvangt dit bericht vanwege een meldingsregel voor dit bord.',
    textHeader: 'Nieuw ticket op {{ticket.board}} voor {{ticket.clientName}}',
  },
  it: {
    subject: 'Nuovo ticket su {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Nuovo ticket sulla bacheca',
    intro: 'È stato registrato un nuovo ticket sulla bacheca <strong>{{ticket.board}}</strong> per <strong>{{ticket.clientName}}</strong>. Ricevi questo messaggio a causa di una regola di notifica per questa bacheca.',
    textHeader: 'Nuovo ticket su {{ticket.board}} per {{ticket.clientName}}',
  },
  pl: {
    subject: 'Nowe zgłoszenie na tablicy {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Nowe zgłoszenie na tablicy',
    intro: 'Na tablicy <strong>{{ticket.board}}</strong> utworzono nowe zgłoszenie dla <strong>{{ticket.clientName}}</strong>. Otrzymujesz tę wiadomość z powodu reguły powiadomień dla tej tablicy.',
    textHeader: 'Nowe zgłoszenie na tablicy {{ticket.board}} dla {{ticket.clientName}}',
  },
  pt: {
    subject: 'Novo ticket em {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Novo ticket no quadro',
    intro: 'Um novo ticket foi registrado no quadro <strong>{{ticket.board}}</strong> para <strong>{{ticket.clientName}}</strong>. Você está recebendo esta mensagem por causa de uma regra de notificação deste quadro.',
    textHeader: 'Novo ticket em {{ticket.board}} para {{ticket.clientName}}',
  },
  sv: {
    subject: 'Nytt ärende på {{ticket.board}} • {{ticket.title}} ({{ticket.priority}})',
    headerLabel: 'Nytt ärende på tavlan',
    intro: 'Ett nytt ärende har registrerats på tavlan <strong>{{ticket.board}}</strong> för <strong>{{ticket.clientName}}</strong>. Du får detta meddelande på grund av en aviseringsregel för tavlan.',
    textHeader: 'Nytt ärende på {{ticket.board}} för {{ticket.clientName}}',
  },
};
/* eslint-enable max-len */

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(LOCALIZED).map(([lang, loc]) => {
      const copy = { ...BASE_COPY[lang], ...loc };
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
