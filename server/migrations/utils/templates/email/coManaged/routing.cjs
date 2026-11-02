/**
 * Source-of-truth: co-managed-routing email template (CM L5, alga-2026-0002879).
 *
 * One generic notification for the three routing moments of a shared ticket (escalation received,
 * escalation returned, assignment). The headline/body arrive as context so the wording lives with the
 * in-app catalog rows in 20261031090100_seed_co_managed_notification_catalog.cjs. Only the link and
 * footer copy below is per-language.
 */
const TEMPLATE_NAME = 'co-managed-routing';
const SUBTYPE_NAME = 'co-managed-routing';

// Per-language copy for the link and footer; the headline and body arrive in context.
const COPY = {
  en: { open: 'Open ticket #{{ticket.id}}', automated: 'This is an automated message. Please do not reply to this email.' },
  fr: { open: 'Voir le ticket #{{ticket.id}}', automated: 'Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.' },
  es: { open: 'Ver ticket #{{ticket.id}}', automated: 'Este es un mensaje automático. No responda a este correo.' },
  de: { open: 'Ticket #{{ticket.id}} anzeigen', automated: 'Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.' },
  nl: { open: 'Ticket #{{ticket.id}} bekijken', automated: 'Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.' },
  it: { open: 'Apri ticket #{{ticket.id}}', automated: 'Questo è un messaggio automatico. Non rispondere a questa email.' },
  pl: { open: 'Zobacz zgłoszenie #{{ticket.id}}', automated: 'To automatyczna wiadomość. Nie odpowiadaj na ten e-mail.' },
  pt: { open: 'Ver ticket #{{ticket.id}}', automated: 'Esta é uma mensagem automática. Não responda a este email.' },
  sv: { open: 'Visa ärende #{{ticket.id}}', automated: 'Det här är ett automatiskt meddelande. Svara inte på det här e-postmeddelandet.' },
};

function renderHtml(c) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#222;">
  <h2 style="margin:0 0 12px 0;">{{routing.headline}}</h2>
  <p>{{routing.body}}</p>
  <p><a href="{{ticket.url}}">${c.open}</a></p>
  <p style="color:#666;font-size:12px;">${c.automated}</p>
</body></html>`;
}

function renderText(c) {
  return `{{routing.headline}}

{{routing.body}}

${c.open}: {{ticket.url}}

${c.automated}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([language, c]) => ({
      language, subject: '{{routing.headline}}', htmlContent: renderHtml(c), textContent: renderText(c),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
