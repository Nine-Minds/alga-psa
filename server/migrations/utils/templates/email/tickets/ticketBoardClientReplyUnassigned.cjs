/**
 * Source-of-truth: ticket-board-client-reply-unassigned email template.
 *
 * Sent to internal users (and plain addresses) selected by a board notification
 * rule when a client replies to a ticket that has no assignee. Built on the
 * ticket-comment-added body so the reply itself is quoted and the context
 * variables are identical (ticket.board, ticket.url, comment.content, ...).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { COPY: BASE_COPY, buildBodyHtml, buildText } = require('./ticketCommentAdded.cjs');

const TEMPLATE_NAME = 'ticket-board-client-reply-unassigned';
const SUBTYPE_NAME = 'Board Client Reply Unassigned';

/* eslint-disable max-len */
const LOCALIZED = {
  en: {
    subject: 'Client Reply, Unassigned on {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Client Reply, Nobody Assigned',
    intro: '<strong>{{comment.author}}</strong> replied for <strong>{{ticket.clientName}}</strong> on the <strong>{{ticket.board}}</strong> board, and this ticket has no assignee. You are receiving this because of a notification rule for this board.',
    textHeader: 'Client Reply on an Unassigned Ticket ({{ticket.board}})',
  },
  fr: {
    subject: 'Réponse du client, ticket non assigné sur {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Réponse du client, ticket non assigné',
    intro: '<strong>{{comment.author}}</strong> a répondu pour <strong>{{ticket.clientName}}</strong> sur le tableau <strong>{{ticket.board}}</strong>, et ce ticket n\'a pas de responsable. Vous recevez ce message en raison d\'une règle de notification pour ce tableau.',
    textHeader: 'Réponse du client sur un ticket non assigné ({{ticket.board}})',
  },
  es: {
    subject: 'Respuesta del cliente, ticket sin asignar en {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Respuesta del cliente, ticket sin asignar',
    intro: '<strong>{{comment.author}}</strong> respondió por <strong>{{ticket.clientName}}</strong> en el tablero <strong>{{ticket.board}}</strong> y este ticket no tiene responsable asignado. Recibe este mensaje por una regla de notificación de este tablero.',
    textHeader: 'Respuesta del cliente en un ticket sin asignar ({{ticket.board}})',
  },
  de: {
    subject: 'Kundenantwort, Ticket ohne Zuweisung auf {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Kundenantwort, Ticket ohne Zuweisung',
    intro: '<strong>{{comment.author}}</strong> hat für <strong>{{ticket.clientName}}</strong> auf dem Board <strong>{{ticket.board}}</strong> geantwortet, und dieses Ticket ist niemandem zugewiesen. Sie erhalten diese Nachricht aufgrund einer Benachrichtigungsregel für dieses Board.',
    textHeader: 'Kundenantwort auf einem nicht zugewiesenen Ticket ({{ticket.board}})',
  },
  nl: {
    subject: 'Reactie van de klant, ticket niet toegewezen op {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Reactie van de klant, ticket niet toegewezen',
    intro: '<strong>{{comment.author}}</strong> heeft gereageerd voor <strong>{{ticket.clientName}}</strong> op het bord <strong>{{ticket.board}}</strong>, en dit ticket is aan niemand toegewezen. U ontvangt dit bericht vanwege een meldingsregel voor dit bord.',
    textHeader: 'Reactie van de klant op een niet-toegewezen ticket ({{ticket.board}})',
  },
  it: {
    subject: 'Risposta del cliente, ticket non assegnato su {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Risposta del cliente, ticket non assegnato',
    intro: '<strong>{{comment.author}}</strong> ha risposto per <strong>{{ticket.clientName}}</strong> sulla bacheca <strong>{{ticket.board}}</strong> e questo ticket non è assegnato a nessuno. Ricevi questo messaggio a causa di una regola di notifica per questa bacheca.',
    textHeader: 'Risposta del cliente su un ticket non assegnato ({{ticket.board}})',
  },
  pl: {
    subject: 'Odpowiedź klienta, zgłoszenie nieprzypisane na tablicy {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Odpowiedź klienta, zgłoszenie nieprzypisane',
    intro: '<strong>{{comment.author}}</strong> odpowiedział(a) w imieniu <strong>{{ticket.clientName}}</strong> na tablicy <strong>{{ticket.board}}</strong>, a to zgłoszenie nie ma przypisanej osoby. Otrzymujesz tę wiadomość z powodu reguły powiadomień dla tej tablicy.',
    textHeader: 'Odpowiedź klienta w nieprzypisanym zgłoszeniu ({{ticket.board}})',
  },
  pt: {
    subject: 'Resposta do cliente, ticket sem responsável em {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Resposta do cliente, ticket sem responsável',
    intro: '<strong>{{comment.author}}</strong> respondeu por <strong>{{ticket.clientName}}</strong> no quadro <strong>{{ticket.board}}</strong> e este ticket não tem responsável. Você está recebendo esta mensagem por causa de uma regra de notificação deste quadro.',
    textHeader: 'Resposta do cliente em um ticket sem responsável ({{ticket.board}})',
  },
  sv: {
    subject: 'Kundsvar, ärendet är otilldelat på {{ticket.board}} • {{ticket.title}}',
    headerLabel: 'Kundsvar, ärendet är otilldelat',
    intro: '<strong>{{comment.author}}</strong> svarade för <strong>{{ticket.clientName}}</strong> på tavlan <strong>{{ticket.board}}</strong>, och ärendet är inte tilldelat någon. Du får detta meddelande på grund av en aviseringsregel för tavlan.',
    textHeader: 'Kundsvar på ett otilldelat ärende ({{ticket.board}})',
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
