/**
 * Source-of-truth: SLA escalation email template.
 *
 * Sent when a ticket is escalated due to SLA concerns.
 * SLA notifications are internal-only (MSP technicians/managers).
 */

const { wrapEmailLayout } = require('../../_shared/emailLayout.cjs');
const { BRAND_PRIMARY, BADGE_BG, BRAND_DARK } = require('../../_shared/constants.cjs');

const TEMPLATE_NAME = 'sla-escalation';
const SUBTYPE_NAME = 'SLA Escalation';

const SUBJECTS = {
  en: 'Ticket Escalated: #{{ticketNumber}} - Level {{escalationLevel}}',
  fr: 'Ticket escalad\u00e9\u00a0: #{{ticketNumber}} - niveau {{escalationLevel}}',
  es: 'Ticket escalado: #{{ticketNumber}} - nivel {{escalationLevel}}',
  de: 'Ticket eskaliert: #{{ticketNumber}} - Stufe {{escalationLevel}}',
  nl: 'Ticket ge\u00ebscaleerd: #{{ticketNumber}} - niveau {{escalationLevel}}',
  it: 'Ticket scalato: #{{ticketNumber}} - livello {{escalationLevel}}',
  pl: 'Zg\u0142oszenie eskalowane: #{{ticketNumber}} - poziom {{escalationLevel}}',
};

/* eslint-disable max-len */
const COPY = {
  en: {
    headerLabel: 'Ticket Escalation',
    headerTitle: 'Level {{escalationLevel}} Escalation',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hi {{recipientName}},',
    intro: 'A ticket has been escalated to you due to SLA concerns. You have been added as an escalation manager.',
    ticket: 'Ticket',
    escalationLevel: 'Escalation Level',
    levelPrefix: 'Level',
    reason: 'Reason',
    priority: 'Priority',
    client: 'Client',
    assignedTo: 'Assigned To',
    callToAction: 'Please review this ticket and take appropriate action.',
    viewButton: 'View Ticket',
    footer: 'Powered by Alga PSA &middot; Keeping teams aligned',
    textHeader: 'TICKET ESCALATION: Level {{escalationLevel}}',
    textGreeting: 'Hi {{recipientName}},',
    textIntro: 'A ticket has been escalated to you due to SLA concerns. You have been added as an escalation manager.',
    textDetailsHeader: 'Ticket Details:',
    textTicket: 'Ticket',
    textEscalationLevel: 'Escalation Level',
    textLevelPrefix: 'Level',
    textReason: 'Reason',
    textPriority: 'Priority',
    textClient: 'Client',
    textAssignedTo: 'Assigned To',
    textCallToAction: 'Please review this ticket and take appropriate action.',
    textView: 'View Ticket',
    textFooter: 'Powered by Alga PSA',
  },
  fr: {
    headerLabel: 'Escalade du ticket',
    headerTitle: 'Escalade de niveau {{escalationLevel}}',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Bonjour {{recipientName}},',
    intro: 'Un ticket vous a \u00e9t\u00e9 escalad\u00e9 en raison de pr\u00e9occupations li\u00e9es au SLA. Vous avez \u00e9t\u00e9 ajout\u00e9 comme responsable d\'escalade.',
    ticket: 'Ticket',
    escalationLevel: 'Niveau d\'escalade',
    levelPrefix: 'Niveau',
    reason: 'Motif',
    priority: 'Priorit\u00e9',
    client: 'Client',
    assignedTo: 'Assign\u00e9 \u00e0',
    callToAction: 'Veuillez examiner ce ticket et prendre les mesures appropri\u00e9es.',
    viewButton: 'Voir le ticket',
    footer: 'Powered by Alga PSA &middot; Gardons les \u00e9quipes align\u00e9es',
    textHeader: 'ESCALADE DU TICKET\u00a0: niveau {{escalationLevel}}',
    textGreeting: 'Bonjour {{recipientName}},',
    textIntro: 'Un ticket vous a \u00e9t\u00e9 escalad\u00e9 en raison de pr\u00e9occupations li\u00e9es au SLA. Vous avez \u00e9t\u00e9 ajout\u00e9 comme responsable d\'escalade.',
    textDetailsHeader: 'D\u00e9tails du ticket\u00a0:',
    textTicket: 'Ticket',
    textEscalationLevel: 'Niveau d\'escalade',
    textLevelPrefix: 'Niveau',
    textReason: 'Motif',
    textPriority: 'Priorit\u00e9',
    textClient: 'Client',
    textAssignedTo: 'Assign\u00e9 \u00e0',
    textCallToAction: 'Veuillez examiner ce ticket et prendre les mesures appropri\u00e9es.',
    textView: 'Voir le ticket',
    textFooter: 'Powered by Alga PSA',
  },
  es: {
    headerLabel: 'Escalada del ticket',
    headerTitle: 'Escalada de nivel {{escalationLevel}}',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hola {{recipientName}},',
    intro: 'Se le ha escalado un ticket debido a preocupaciones de SLA. Ha sido agregado como gestor de escalada.',
    ticket: 'Ticket',
    escalationLevel: 'Nivel de escalada',
    levelPrefix: 'Nivel',
    reason: 'Motivo',
    priority: 'Prioridad',
    client: 'Cliente',
    assignedTo: 'Asignado a',
    callToAction: 'Por favor, revise este ticket y tome las medidas correspondientes.',
    viewButton: 'Ver ticket',
    footer: 'Powered by Alga PSA &middot; Manteniendo a los equipos alineados',
    textHeader: 'ESCALADA DEL TICKET: nivel {{escalationLevel}}',
    textGreeting: 'Hola {{recipientName}},',
    textIntro: 'Se le ha escalado un ticket debido a preocupaciones de SLA. Ha sido agregado como gestor de escalada.',
    textDetailsHeader: 'Detalles del ticket:',
    textTicket: 'Ticket',
    textEscalationLevel: 'Nivel de escalada',
    textLevelPrefix: 'Nivel',
    textReason: 'Motivo',
    textPriority: 'Prioridad',
    textClient: 'Cliente',
    textAssignedTo: 'Asignado a',
    textCallToAction: 'Por favor, revise este ticket y tome las medidas correspondientes.',
    textView: 'Ver ticket',
    textFooter: 'Powered by Alga PSA',
  },
  de: {
    headerLabel: 'Ticket-Eskalation',
    headerTitle: 'Eskalation der Stufe {{escalationLevel}}',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hallo {{recipientName}},',
    intro: 'Ein Ticket wurde aufgrund von SLA-Bedenken an Sie eskaliert. Sie wurden als Eskalationsmanager hinzugef\u00fcgt.',
    ticket: 'Ticket',
    escalationLevel: 'Eskalationsstufe',
    levelPrefix: 'Stufe',
    reason: 'Grund',
    priority: 'Priorit\u00e4t',
    client: 'Kunde',
    assignedTo: 'Zugewiesen an',
    callToAction: 'Bitte pr\u00fcfen Sie dieses Ticket und ergreifen Sie entsprechende Ma\u00dfnahmen.',
    viewButton: 'Ticket anzeigen',
    footer: 'Powered by Alga PSA &middot; Teams auf Kurs halten',
    textHeader: 'TICKET-ESKALATION: Stufe {{escalationLevel}}',
    textGreeting: 'Hallo {{recipientName}},',
    textIntro: 'Ein Ticket wurde aufgrund von SLA-Bedenken an Sie eskaliert. Sie wurden als Eskalationsmanager hinzugef\u00fcgt.',
    textDetailsHeader: 'Ticket-Details:',
    textTicket: 'Ticket',
    textEscalationLevel: 'Eskalationsstufe',
    textLevelPrefix: 'Stufe',
    textReason: 'Grund',
    textPriority: 'Priorit\u00e4t',
    textClient: 'Kunde',
    textAssignedTo: 'Zugewiesen an',
    textCallToAction: 'Bitte pr\u00fcfen Sie dieses Ticket und ergreifen Sie entsprechende Ma\u00dfnahmen.',
    textView: 'Ticket anzeigen',
    textFooter: 'Powered by Alga PSA',
  },
  nl: {
    headerLabel: 'Ticket-escalatie',
    headerTitle: 'Escalatie niveau {{escalationLevel}}',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Hallo {{recipientName}},',
    intro: 'Een ticket is vanwege SLA-zorgen naar u ge\u00ebscaleerd. U bent toegevoegd als escalatiemanager.',
    ticket: 'Ticket',
    escalationLevel: 'Escalatieniveau',
    levelPrefix: 'Niveau',
    reason: 'Reden',
    priority: 'Prioriteit',
    client: 'Klant',
    assignedTo: 'Toegewezen aan',
    callToAction: 'Beoordeel dit ticket en onderneem passende actie.',
    viewButton: 'Ticket bekijken',
    footer: 'Powered by Alga PSA &middot; Teams op \u00e9\u00e9n lijn houden',
    textHeader: 'TICKET-ESCALATIE: niveau {{escalationLevel}}',
    textGreeting: 'Hallo {{recipientName}},',
    textIntro: 'Een ticket is vanwege SLA-zorgen naar u ge\u00ebscaleerd. U bent toegevoegd als escalatiemanager.',
    textDetailsHeader: 'Ticketgegevens:',
    textTicket: 'Ticket',
    textEscalationLevel: 'Escalatieniveau',
    textLevelPrefix: 'Niveau',
    textReason: 'Reden',
    textPriority: 'Prioriteit',
    textClient: 'Klant',
    textAssignedTo: 'Toegewezen aan',
    textCallToAction: 'Beoordeel dit ticket en onderneem passende actie.',
    textView: 'Ticket bekijken',
    textFooter: 'Powered by Alga PSA',
  },
  it: {
    headerLabel: 'Escalation del ticket',
    headerTitle: 'Escalation di livello {{escalationLevel}}',
    headerMeta: 'Ticket #{{ticketNumber}}',
    greeting: 'Ciao {{recipientName}},',
    intro: 'Un ticket \u00e8 stato scalato a te per motivi di SLA. Sei stato aggiunto come responsabile dell\'escalation.',
    ticket: 'Ticket',
    escalationLevel: 'Livello di escalation',
    levelPrefix: 'Livello',
    reason: 'Motivo',
    priority: 'Priorit\u00e0',
    client: 'Cliente',
    assignedTo: 'Assegnato a',
    callToAction: 'Esamina questo ticket e intraprendi le azioni appropriate.',
    viewButton: 'Apri ticket',
    footer: 'Powered by Alga PSA &middot; Manteniamo i team allineati',
    textHeader: 'ESCALATION DEL TICKET: livello {{escalationLevel}}',
    textGreeting: 'Ciao {{recipientName}},',
    textIntro: 'Un ticket \u00e8 stato scalato a te per motivi di SLA. Sei stato aggiunto come responsabile dell\'escalation.',
    textDetailsHeader: 'Dettagli del ticket:',
    textTicket: 'Ticket',
    textEscalationLevel: 'Livello di escalation',
    textLevelPrefix: 'Livello',
    textReason: 'Motivo',
    textPriority: 'Priorit\u00e0',
    textClient: 'Cliente',
    textAssignedTo: 'Assegnato a',
    textCallToAction: 'Esamina questo ticket e intraprendi le azioni appropriate.',
    textView: 'Apri ticket',
    textFooter: 'Powered by Alga PSA',
  },
  pl: {
    headerLabel: 'Eskalacja zg\u0142oszenia',
    headerTitle: 'Eskalacja poziomu {{escalationLevel}}',
    headerMeta: 'Zg\u0142oszenie #{{ticketNumber}}',
    greeting: 'Witaj {{recipientName}},',
    intro: 'Zg\u0142oszenie zosta\u0142o eskalowane do Ciebie z powod\u00f3w SLA. Zosta\u0142e\u015b(a\u015b) dodany(a) jako mened\u017cer eskalacji.',
    ticket: 'Zg\u0142oszenie',
    escalationLevel: 'Poziom eskalacji',
    levelPrefix: 'Poziom',
    reason: 'Pow\u00f3d',
    priority: 'Priorytet',
    client: 'Klient',
    assignedTo: 'Przypisane do',
    callToAction: 'Zapoznaj si\u0119 z tym zg\u0142oszeniem i podejmij odpowiednie dzia\u0142ania.',
    viewButton: 'Zobacz zg\u0142oszenie',
    footer: 'Powered by Alga PSA',
    textHeader: 'ESKALACJA ZG\u0141OSZENIA: poziom {{escalationLevel}}',
    textGreeting: 'Witaj {{recipientName}},',
    textIntro: 'Zg\u0142oszenie zosta\u0142o eskalowane do Ciebie z powod\u00f3w SLA. Zosta\u0142e\u015b(a\u015b) dodany(a) jako mened\u017cer eskalacji.',
    textDetailsHeader: 'Szczeg\u00f3\u0142y zg\u0142oszenia:',
    textTicket: 'Zg\u0142oszenie',
    textEscalationLevel: 'Poziom eskalacji',
    textLevelPrefix: 'Poziom',
    textReason: 'Pow\u00f3d',
    textPriority: 'Priorytet',
    textClient: 'Klient',
    textAssignedTo: 'Przypisane do',
    textCallToAction: 'Zapoznaj si\u0119 z tym zg\u0142oszeniem i podejmij odpowiednie dzia\u0142ania.',
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
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.escalationLevel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="font-size:16px;font-weight:700;color:${BRAND_PRIMARY};">${c.levelPrefix} {{escalationLevel}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${c.reason}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{escalationReason}}</td>
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
                <td style="padding:12px 0;font-weight:600;color:#475467;">${c.assignedTo}</td>
                <td style="padding:12px 0;">{{assigneeName}}</td>
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
- ${c.textEscalationLevel}: ${c.textLevelPrefix} {{escalationLevel}}
- ${c.textReason}: {{escalationReason}}
- ${c.textPriority}: {{priority}}
- ${c.textClient}: {{clientName}}
- ${c.textAssignedTo}: {{assigneeName}}

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
