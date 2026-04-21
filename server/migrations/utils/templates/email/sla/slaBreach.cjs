/**
 * Source-of-truth: SLA breach email template.
 *
 * Sent when a ticket has exceeded its SLA target.
 * SLA notifications are internal-only (MSP technicians/managers).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY, BADGE_BG, BRAND_DARK } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'sla-breach';
const SUBTYPE_NAME = 'SLA Breach';

const SUBJECTS = {
  en: 'SLA BREACH: Ticket #{{ticketNumber}} - {{slaType}} SLA Exceeded',
  fr: 'VIOLATION DE SLA\u00a0: ticket #{{ticketNumber}} - SLA {{slaType}} d\u00e9pass\u00e9',
  es: 'INCUMPLIMIENTO DE SLA: ticket #{{ticketNumber}} - SLA {{slaType}} superado',
  de: 'SLA-VERLETZUNG: Ticket #{{ticketNumber}} - SLA {{slaType}} \u00fcberschritten',
  nl: 'SLA-OVERSCHRIJDING: ticket #{{ticketNumber}} - SLA {{slaType}} overschreden',
  it: 'VIOLAZIONE SLA: ticket #{{ticketNumber}} - SLA {{slaType}} superato',
  pl: 'NARUSZENIE SLA: zg\u0142oszenie #{{ticketNumber}} - SLA {{slaType}} przekroczone',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'SLA Breach',
    headerTitle: '{{slaType}} SLA Exceeded',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hi {{recipientName}},',
    alert: 'A ticket has breached its SLA target and requires immediate attention.',
    ticket: 'Ticket',
    slaType: 'SLA Type',
    timeOverdue: 'Time Overdue',
    priority: 'Priority',
    client: 'Client',
    policy: 'SLA Policy',
    callToAction: 'Please address this ticket immediately.',
    viewButton: 'View Ticket Now',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'SLA BREACH: {{slaType}} SLA Exceeded',
    textGreeting: 'Hi {{recipientName}},',
    textAlert: 'A ticket has breached its SLA target and requires immediate attention.',
    textDetailsHeader: 'Ticket Details:',
    textTicket: 'Ticket',
    textSlaType: 'SLA Type',
    textTimeOverdue: 'Time Overdue',
    textPriority: 'Priority',
    textClient: 'Client',
    textPolicy: 'SLA Policy',
    textCallToAction: 'Please address this ticket immediately.',
    textView: 'View Ticket',
    textFooter: 'Powered by Alga PSA',
  },
  fr: {
    headerLabel: 'Violation de SLA',
    headerTitle: 'SLA {{slaType}} d\u00e9pass\u00e9',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Bonjour {{recipientName}},',
    alert: 'Un ticket a d\u00e9pass\u00e9 son objectif SLA et n\u00e9cessite une attention imm\u00e9diate.',
    ticket: 'Ticket',
    slaType: 'Type de SLA',
    timeOverdue: 'Temps de retard',
    priority: 'Priorit\u00e9',
    client: 'Client',
    policy: 'Politique SLA',
    callToAction: 'Veuillez traiter ce ticket imm\u00e9diatement.',
    viewButton: 'Voir le ticket maintenant',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'VIOLATION DE SLA\u00a0: SLA {{slaType}} d\u00e9pass\u00e9',
    textGreeting: 'Bonjour {{recipientName}},',
    textAlert: 'Un ticket a d\u00e9pass\u00e9 son objectif SLA et n\u00e9cessite une attention imm\u00e9diate.',
    textDetailsHeader: 'D\u00e9tails du ticket\u00a0:',
    textTicket: 'Ticket',
    textSlaType: 'Type de SLA',
    textTimeOverdue: 'Temps de retard',
    textPriority: 'Priorit\u00e9',
    textClient: 'Client',
    textPolicy: 'Politique SLA',
    textCallToAction: 'Veuillez traiter ce ticket imm\u00e9diatement.',
    textView: 'Voir le ticket',
    textFooter: 'Powered by Alga PSA',
  },
  es: {
    headerLabel: 'Incumplimiento de SLA',
    headerTitle: 'SLA {{slaType}} superado',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hola {{recipientName}},',
    alert: 'Un ticket ha incumplido su objetivo de SLA y requiere atenci\u00f3n inmediata.',
    ticket: 'Ticket',
    slaType: 'Tipo de SLA',
    timeOverdue: 'Tiempo de retraso',
    priority: 'Prioridad',
    client: 'Cliente',
    policy: 'Pol\u00edtica de SLA',
    callToAction: 'Por favor, atienda este ticket de inmediato.',
    viewButton: 'Ver ticket ahora',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'INCUMPLIMIENTO DE SLA: SLA {{slaType}} superado',
    textGreeting: 'Hola {{recipientName}},',
    textAlert: 'Un ticket ha incumplido su objetivo de SLA y requiere atenci\u00f3n inmediata.',
    textDetailsHeader: 'Detalles del ticket:',
    textTicket: 'Ticket',
    textSlaType: 'Tipo de SLA',
    textTimeOverdue: 'Tiempo de retraso',
    textPriority: 'Prioridad',
    textClient: 'Cliente',
    textPolicy: 'Pol\u00edtica de SLA',
    textCallToAction: 'Por favor, atienda este ticket de inmediato.',
    textView: 'Ver ticket',
    textFooter: 'Powered by Alga PSA',
  },
  de: {
    headerLabel: 'SLA-Verletzung',
    headerTitle: 'SLA {{slaType}} \u00fcberschritten',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hallo {{recipientName}},',
    alert: 'Ein Ticket hat sein SLA-Ziel verletzt und erfordert sofortige Aufmerksamkeit.',
    ticket: 'Ticket',
    slaType: 'SLA-Typ',
    timeOverdue: 'Verz\u00f6gerung',
    priority: 'Priorit\u00e4t',
    client: 'Kunde',
    policy: 'SLA-Richtlinie',
    callToAction: 'Bitte bearbeiten Sie dieses Ticket sofort.',
    viewButton: 'Ticket jetzt anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'SLA-VERLETZUNG: SLA {{slaType}} \u00fcberschritten',
    textGreeting: 'Hallo {{recipientName}},',
    textAlert: 'Ein Ticket hat sein SLA-Ziel verletzt und erfordert sofortige Aufmerksamkeit.',
    textDetailsHeader: 'Ticket-Details:',
    textTicket: 'Ticket',
    textSlaType: 'SLA-Typ',
    textTimeOverdue: 'Verz\u00f6gerung',
    textPriority: 'Priorit\u00e4t',
    textClient: 'Kunde',
    textPolicy: 'SLA-Richtlinie',
    textCallToAction: 'Bitte bearbeiten Sie dieses Ticket sofort.',
    textView: 'Ticket anzeigen',
    textFooter: 'Powered by Alga PSA',
  },
  nl: {
    headerLabel: 'SLA-overschrijding',
    headerTitle: 'SLA {{slaType}} overschreden',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hallo {{recipientName}},',
    alert: 'Een ticket heeft zijn SLA-doelstelling overschreden en vereist onmiddellijke aandacht.',
    ticket: 'Ticket',
    slaType: 'SLA-type',
    timeOverdue: 'Tijd over tijd',
    priority: 'Prioriteit',
    client: 'Klant',
    policy: 'SLA-beleid',
    callToAction: 'Behandel dit ticket onmiddellijk.',
    viewButton: 'Ticket nu bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'SLA-OVERSCHRIJDING: SLA {{slaType}} overschreden',
    textGreeting: 'Hallo {{recipientName}},',
    textAlert: 'Een ticket heeft zijn SLA-doelstelling overschreden en vereist onmiddellijke aandacht.',
    textDetailsHeader: 'Ticketgegevens:',
    textTicket: 'Ticket',
    textSlaType: 'SLA-type',
    textTimeOverdue: 'Tijd over tijd',
    textPriority: 'Prioriteit',
    textClient: 'Klant',
    textPolicy: 'SLA-beleid',
    textCallToAction: 'Behandel dit ticket onmiddellijk.',
    textView: 'Ticket bekijken',
    textFooter: 'Powered by Alga PSA',
  },
  it: {
    headerLabel: 'Violazione SLA',
    headerTitle: 'SLA {{slaType}} superato',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Ciao {{recipientName}},',
    alert: 'Un ticket ha violato il proprio obiettivo SLA e richiede attenzione immediata.',
    ticket: 'Ticket',
    slaType: 'Tipo di SLA',
    timeOverdue: 'Tempo di ritardo',
    priority: 'Priorit\u00e0',
    client: 'Cliente',
    policy: 'Criterio SLA',
    callToAction: 'Gestisci immediatamente questo ticket.',
    viewButton: 'Apri ticket ora',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'VIOLAZIONE SLA: SLA {{slaType}} superato',
    textGreeting: 'Ciao {{recipientName}},',
    textAlert: 'Un ticket ha violato il proprio obiettivo SLA e richiede attenzione immediata.',
    textDetailsHeader: 'Dettagli del ticket:',
    textTicket: 'Ticket',
    textSlaType: 'Tipo di SLA',
    textTimeOverdue: 'Tempo di ritardo',
    textPriority: 'Priorit\u00e0',
    textClient: 'Cliente',
    textPolicy: 'Criterio SLA',
    textCallToAction: 'Gestisci immediatamente questo ticket.',
    textView: 'Apri ticket',
    textFooter: 'Powered by Alga PSA',
  },
  pl: {
    headerLabel: 'Naruszenie SLA',
    headerTitle: 'SLA {{slaType}} przekroczone',
    headerMeta: 'Zg\u0142oszenie #{{ticketNumber}}',
    greeting: 'Witaj {{recipientName}},',
    alert: 'Zg\u0142oszenie naruszy\u0142o cel SLA i wymaga natychmiastowej uwagi.',
    ticket: 'Zg\u0142oszenie',
    slaType: 'Typ SLA',
    timeOverdue: 'Op\u00f3\u017anienie',
    priority: 'Priorytet',
    client: 'Klient',
    policy: 'Zasada SLA',
    callToAction: 'Zajmij si\u0119 tym zg\u0142oszeniem natychmiast.',
    viewButton: 'Zobacz zg\u0142oszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'NARUSZENIE SLA: SLA {{slaType}} przekroczone',
    textGreeting: 'Witaj {{recipientName}},',
    textAlert: 'Zg\u0142oszenie naruszy\u0142o cel SLA i wymaga natychmiastowej uwagi.',
    textDetailsHeader: 'Szczeg\u00f3\u0142y zg\u0142oszenia:',
    textTicket: 'Zg\u0142oszenie',
    textSlaType: 'Typ SLA',
    textTimeOverdue: 'Op\u00f3\u017anienie',
    textPriority: 'Priorytet',
    textClient: 'Klient',
    textPolicy: 'Zasada SLA',
    textCallToAction: 'Zajmij si\u0119 tym zg\u0142oszeniem natychmiast.',
    textView: 'Zobacz zg\u0142oszenie',
    textFooter: 'Powered by Alga PSA',
  },
};
/* eslint-enable max-len */

function buildBodyHtml(c) {
  return `<p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${c.greeting}</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#dc2626;line-height:1.5;font-weight:600;">${c.alert}</p>
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
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.timeOverdue}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="font-size:16px;font-weight:700;color:#dc2626;">{{timeOverdue}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.priority}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{priority}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.client}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{clientName}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">${c.policy}</td>
                <td style="padding:12px 0;">{{policyName}}</td>
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

${c.textAlert}

${c.textDetailsHeader}
- ${c.textTicket}: #{{ticketNumber}} - {{ticketTitle}}
- ${c.textSlaType}: {{slaType}}
- ${c.textTimeOverdue}: {{timeOverdue}}
- ${c.textPriority}: {{priority}}
- ${c.textClient}: {{clientName}}
- ${c.textPolicy}: {{policyName}}

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
