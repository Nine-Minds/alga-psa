/**
 * Source-of-truth: SLA warning email template.
 *
 * Sent when a ticket is approaching its SLA deadline (threshold-based).
 * SLA notifications are internal-only (MSP technicians/managers).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY, BADGE_BG, BRAND_DARK } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'sla-warning';
const SUBTYPE_NAME = 'SLA Warning';

const SUBJECTS = {
  en: 'SLA Warning: Ticket #{{ticketNumber}} at {{thresholdPercent}}%',
  fr: 'Alerte SLA\u00a0: ticket #{{ticketNumber}} \u00e0 {{thresholdPercent}}\u00a0%',
  es: 'Alerta de SLA: ticket #{{ticketNumber}} al {{thresholdPercent}}%',
  de: 'SLA-Warnung: Ticket #{{ticketNumber}} bei {{thresholdPercent}}%',
  nl: 'SLA-waarschuwing: ticket #{{ticketNumber}} op {{thresholdPercent}}%',
  it: 'Avviso SLA: ticket #{{ticketNumber}} al {{thresholdPercent}}%',
  pl: 'Ostrze\u017cenie SLA: zg\u0142oszenie #{{ticketNumber}} na poziomie {{thresholdPercent}}%',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'SLA Warning',
    headerTitle: '{{thresholdPercent}}% Time Elapsed',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hi {{recipientName}},',
    intro: 'A ticket you are responsible for is approaching its SLA deadline.',
    ticket: 'Ticket',
    slaType: 'SLA Type',
    timeRemaining: 'Time Remaining',
    priority: 'Priority',
    client: 'Client',
    callToAction: 'Please take action to avoid an SLA breach.',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'SLA WARNING: {{thresholdPercent}}% Time Elapsed',
    textGreeting: 'Hi {{recipientName}},',
    textIntro: 'A ticket you are responsible for is approaching its SLA deadline.',
    textDetailsHeader: 'Ticket Details:',
    textTicket: 'Ticket',
    textSlaType: 'SLA Type',
    textTimeRemaining: 'Time Remaining',
    textPriority: 'Priority',
    textClient: 'Client',
    textCallToAction: 'Please take action to avoid an SLA breach.',
    textView: 'View Ticket',
    textFooter: 'Powered by Alga PSA',
  },
  fr: {
    headerLabel: 'Alerte SLA',
    headerTitle: '{{thresholdPercent}}\u00a0% du temps \u00e9coul\u00e9',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Bonjour {{recipientName}},',
    intro: 'Un ticket dont vous \u00eates responsable approche de son \u00e9ch\u00e9ance SLA.',
    ticket: 'Ticket',
    slaType: 'Type de SLA',
    timeRemaining: 'Temps restant',
    priority: 'Priorit\u00e9',
    client: 'Client',
    callToAction: 'Veuillez intervenir pour \u00e9viter une violation du SLA.',
    viewButton: 'Voir le ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'ALERTE SLA\u00a0: {{thresholdPercent}}\u00a0% du temps \u00e9coul\u00e9',
    textGreeting: 'Bonjour {{recipientName}},',
    textIntro: 'Un ticket dont vous \u00eates responsable approche de son \u00e9ch\u00e9ance SLA.',
    textDetailsHeader: 'D\u00e9tails du ticket\u00a0:',
    textTicket: 'Ticket',
    textSlaType: 'Type de SLA',
    textTimeRemaining: 'Temps restant',
    textPriority: 'Priorit\u00e9',
    textClient: 'Client',
    textCallToAction: 'Veuillez intervenir pour \u00e9viter une violation du SLA.',
    textView: 'Voir le ticket',
    textFooter: 'Powered by Alga PSA',
  },
  es: {
    headerLabel: 'Alerta de SLA',
    headerTitle: '{{thresholdPercent}}% de tiempo transcurrido',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hola {{recipientName}},',
    intro: 'Un ticket del que usted es responsable se est\u00e1 acercando a su plazo de SLA.',
    ticket: 'Ticket',
    slaType: 'Tipo de SLA',
    timeRemaining: 'Tiempo restante',
    priority: 'Prioridad',
    client: 'Cliente',
    callToAction: 'Por favor, tome medidas para evitar un incumplimiento del SLA.',
    viewButton: 'Ver ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'ALERTA DE SLA: {{thresholdPercent}}% de tiempo transcurrido',
    textGreeting: 'Hola {{recipientName}},',
    textIntro: 'Un ticket del que usted es responsable se est\u00e1 acercando a su plazo de SLA.',
    textDetailsHeader: 'Detalles del ticket:',
    textTicket: 'Ticket',
    textSlaType: 'Tipo de SLA',
    textTimeRemaining: 'Tiempo restante',
    textPriority: 'Prioridad',
    textClient: 'Cliente',
    textCallToAction: 'Por favor, tome medidas para evitar un incumplimiento del SLA.',
    textView: 'Ver ticket',
    textFooter: 'Powered by Alga PSA',
  },
  de: {
    headerLabel: 'SLA-Warnung',
    headerTitle: '{{thresholdPercent}}% der Zeit verstrichen',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hallo {{recipientName}},',
    intro: 'Ein Ticket, f\u00fcr das Sie verantwortlich sind, n\u00e4hert sich seiner SLA-Frist.',
    ticket: 'Ticket',
    slaType: 'SLA-Typ',
    timeRemaining: 'Verbleibende Zeit',
    priority: 'Priorit\u00e4t',
    client: 'Kunde',
    callToAction: 'Bitte ergreifen Sie Ma\u00dfnahmen, um eine SLA-Verletzung zu vermeiden.',
    viewButton: 'Ticket anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'SLA-WARNUNG: {{thresholdPercent}}% der Zeit verstrichen',
    textGreeting: 'Hallo {{recipientName}},',
    textIntro: 'Ein Ticket, f\u00fcr das Sie verantwortlich sind, n\u00e4hert sich seiner SLA-Frist.',
    textDetailsHeader: 'Ticket-Details:',
    textTicket: 'Ticket',
    textSlaType: 'SLA-Typ',
    textTimeRemaining: 'Verbleibende Zeit',
    textPriority: 'Priorit\u00e4t',
    textClient: 'Kunde',
    textCallToAction: 'Bitte ergreifen Sie Ma\u00dfnahmen, um eine SLA-Verletzung zu vermeiden.',
    textView: 'Ticket anzeigen',
    textFooter: 'Powered by Alga PSA',
  },
  nl: {
    headerLabel: 'SLA-waarschuwing',
    headerTitle: '{{thresholdPercent}}% van de tijd verstreken',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hallo {{recipientName}},',
    intro: 'Een ticket waarvoor u verantwoordelijk bent nadert zijn SLA-deadline.',
    ticket: 'Ticket',
    slaType: 'SLA-type',
    timeRemaining: 'Resterende tijd',
    priority: 'Prioriteit',
    client: 'Klant',
    callToAction: 'Onderneem actie om een SLA-overschrijding te voorkomen.',
    viewButton: 'Ticket bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'SLA-WAARSCHUWING: {{thresholdPercent}}% van de tijd verstreken',
    textGreeting: 'Hallo {{recipientName}},',
    textIntro: 'Een ticket waarvoor u verantwoordelijk bent nadert zijn SLA-deadline.',
    textDetailsHeader: 'Ticketgegevens:',
    textTicket: 'Ticket',
    textSlaType: 'SLA-type',
    textTimeRemaining: 'Resterende tijd',
    textPriority: 'Prioriteit',
    textClient: 'Klant',
    textCallToAction: 'Onderneem actie om een SLA-overschrijding te voorkomen.',
    textView: 'Ticket bekijken',
    textFooter: 'Powered by Alga PSA',
  },
  it: {
    headerLabel: 'Avviso SLA',
    headerTitle: '{{thresholdPercent}}% del tempo trascorso',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Ciao {{recipientName}},',
    intro: 'Un ticket di cui sei responsabile si sta avvicinando alla scadenza SLA.',
    ticket: 'Ticket',
    slaType: 'Tipo di SLA',
    timeRemaining: 'Tempo rimanente',
    priority: 'Priorit\u00e0',
    client: 'Cliente',
    callToAction: 'Interveni per evitare una violazione dello SLA.',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'AVVISO SLA: {{thresholdPercent}}% del tempo trascorso',
    textGreeting: 'Ciao {{recipientName}},',
    textIntro: 'Un ticket di cui sei responsabile si sta avvicinando alla scadenza SLA.',
    textDetailsHeader: 'Dettagli del ticket:',
    textTicket: 'Ticket',
    textSlaType: 'Tipo di SLA',
    textTimeRemaining: 'Tempo rimanente',
    textPriority: 'Priorit\u00e0',
    textClient: 'Cliente',
    textCallToAction: 'Interveni per evitare una violazione dello SLA.',
    textView: 'Apri ticket',
    textFooter: 'Powered by Alga PSA',
  },
  pl: {
    headerLabel: 'Ostrze\u017cenie SLA',
    headerTitle: 'Up\u0142yn\u0119\u0142o {{thresholdPercent}}% czasu',
    headerMeta: 'Zg\u0142oszenie #{{ticketNumber}}',
    greeting: 'Witaj {{recipientName}},',
    intro: 'Zg\u0142oszenie, za kt\u00f3re odpowiadasz, zbli\u017ca si\u0119 do terminu SLA.',
    ticket: 'Zg\u0142oszenie',
    slaType: 'Typ SLA',
    timeRemaining: 'Pozosta\u0142y czas',
    priority: 'Priorytet',
    client: 'Klient',
    callToAction: 'Podejmij dzia\u0142ania, aby unikn\u0105\u0107 naruszenia SLA.',
    viewButton: 'Zobacz zg\u0142oszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'OSTRZE\u017bENIE SLA: up\u0142yn\u0119\u0142o {{thresholdPercent}}% czasu',
    textGreeting: 'Witaj {{recipientName}},',
    textIntro: 'Zg\u0142oszenie, za kt\u00f3re odpowiadasz, zbli\u017ca si\u0119 do terminu SLA.',
    textDetailsHeader: 'Szczeg\u00f3\u0142y zg\u0142oszenia:',
    textTicket: 'Zg\u0142oszenie',
    textSlaType: 'Typ SLA',
    textTimeRemaining: 'Pozosta\u0142y czas',
    textPriority: 'Priorytet',
    textClient: 'Klient',
    textCallToAction: 'Podejmij dzia\u0142ania, aby unikn\u0105\u0107 naruszenia SLA.',
    textView: 'Zobacz zg\u0142oszenie',
    textFooter: 'Powered by Alga PSA',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.intro}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${c.ticket}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${BADGE_BG};color:${BRAND_DARK};font-size:12px;font-weight:600;letter-spacing:0.02em;">#{{ticketNumber}}</span>
                  {{ticketTitle}}
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.slaType}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{slaType}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.timeRemaining}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="font-size:16px;font-weight:700;color:#d97706;">{{timeRemaining}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.priority}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{priority}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">${c.client}</td>
                <td style="padding:12px 0;">{{clientName}}</td>
              </tr>
            </table>
            <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.callToAction}</p>
            {{#if ticketUrl}}
            <div style="text-align:center;margin:24px 0;">
              <a href="{{ticketUrl}}" style="display:inline-block;padding:14px 32px;border-radius:8px;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${c.viewButton}</a>
            </div>
            {{/if}}`;
}

function buildText(c) {
  return `${c.textHeader}

${c.textGreeting}

${c.textIntro}

${c.textDetailsHeader}
- ${c.textTicket}: #{{ticketNumber}} - {{ticketTitle}}
- ${c.textSlaType}: {{slaType}}
- ${c.textTimeRemaining}: {{timeRemaining}}
- ${c.textPriority}: {{priority}}
- ${c.textClient}: {{clientName}}

${c.textCallToAction}

{{#if ticketUrl}}
${c.textView}: {{ticketUrl}}
{{/if}}

---
${c.textFooter}`;
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
        headerTitle: copy.headerTitle,
        headerMeta: copy.headerMeta,
        bodyHtml: buildBodyHtml(copy),
        footerText: copy.footer,
      }),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
