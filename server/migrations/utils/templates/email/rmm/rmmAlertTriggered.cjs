'use strict';

/**
 * Source of truth: 'rmm-alert-triggered' system email template.
 *
 * The English copy and markup match the original inline definition in
 * 20260612090200_add_rmm_alert_notifications.cjs; the other locales were added
 * when the template was folded into this module.
 */

const TEMPLATE_NAME = 'rmm-alert-triggered';
const SUBTYPE_NAME = 'RMM Alert Triggered';

const COPY = {
  en: {
    subject: 'RMM Alert ({{severity}}): {{deviceName}}',
    heading: 'RMM Alert',
    intro: 'An alert from {{provider}} matched a rule that notifies you.',
    severity: 'Severity',
    device: 'Device',
    message: 'Message',
    ticket: 'Ticket',
    cta: 'View in Alga PSA',
    textIntro: 'RMM Alert ({{severity}}) on {{deviceName}}: {{message}}',
  },
  fr: {
    subject: 'Alerte RMM ({{severity}}) : {{deviceName}}',
    heading: 'Alerte RMM',
    intro: 'Une alerte de {{provider}} correspond à une règle qui vous notifie.',
    severity: 'Gravité',
    device: 'Appareil',
    message: 'Message',
    ticket: 'Ticket',
    cta: 'Voir dans Alga PSA',
    textIntro: 'Alerte RMM ({{severity}}) sur {{deviceName}} : {{message}}',
  },
  es: {
    subject: 'Alerta de RMM ({{severity}}): {{deviceName}}',
    heading: 'Alerta de RMM',
    intro: 'Una alerta de {{provider}} coincide con una regla que te notifica.',
    severity: 'Severidad',
    device: 'Dispositivo',
    message: 'Mensaje',
    ticket: 'Ticket',
    cta: 'Ver en Alga PSA',
    textIntro: 'Alerta de RMM ({{severity}}) en {{deviceName}}: {{message}}',
  },
  de: {
    subject: 'RMM-Warnung ({{severity}}): {{deviceName}}',
    heading: 'RMM-Warnung',
    intro: 'Eine Warnung von {{provider}} entspricht einer Regel, die Sie benachrichtigt.',
    severity: 'Schweregrad',
    device: 'Gerät',
    message: 'Nachricht',
    ticket: 'Ticket',
    cta: 'In Alga PSA ansehen',
    textIntro: 'RMM-Warnung ({{severity}}) auf {{deviceName}}: {{message}}',
  },
  nl: {
    subject: 'RMM-melding ({{severity}}): {{deviceName}}',
    heading: 'RMM-melding',
    intro: 'Een melding van {{provider}} komt overeen met een regel die u waarschuwt.',
    severity: 'Ernst',
    device: 'Apparaat',
    message: 'Bericht',
    ticket: 'Ticket',
    cta: 'Bekijk in Alga PSA',
    textIntro: 'RMM-melding ({{severity}}) op {{deviceName}}: {{message}}',
  },
  it: {
    subject: 'Avviso RMM ({{severity}}): {{deviceName}}',
    heading: 'Avviso RMM',
    intro: 'Un avviso da {{provider}} corrisponde a una regola che ti avvisa.',
    severity: 'Gravità',
    device: 'Dispositivo',
    message: 'Messaggio',
    ticket: 'Ticket',
    cta: 'Visualizza in Alga PSA',
    textIntro: 'Avviso RMM ({{severity}}) su {{deviceName}}: {{message}}',
  },
  pl: {
    subject: 'Alert RMM ({{severity}}): {{deviceName}}',
    heading: 'Alert RMM',
    intro: 'Alert z {{provider}} pasuje do reguły, która Cię powiadamia.',
    severity: 'Ważność',
    device: 'Urządzenie',
    message: 'Wiadomość',
    ticket: 'Zgłoszenie',
    cta: 'Zobacz w Alga PSA',
    textIntro: 'Alert RMM ({{severity}}) na {{deviceName}}: {{message}}',
  },
  pt: {
    subject: 'Alerta de RMM ({{severity}}): {{deviceName}}',
    heading: 'Alerta de RMM',
    intro: 'Um alerta de {{provider}} correspondeu a uma regra que o notifica.',
    severity: 'Severidade',
    device: 'Dispositivo',
    message: 'Mensagem',
    ticket: 'Ticket',
    cta: 'Ver no Alga PSA',
    textIntro: 'Alerta de RMM ({{severity}}) em {{deviceName}}: {{message}}',
  },
};

function buildHtml(copy) {
  return `
      <h2>${copy.heading}</h2>
      <p>${copy.intro}</p>
      <div class="details">
        <p><strong>${copy.severity}:</strong> {{severity}}</p>
        <p><strong>${copy.device}:</strong> {{deviceName}}</p>
        <p><strong>${copy.message}:</strong> {{message}}</p>
        <p><strong>${copy.ticket}:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">${copy.cta}</a></p>
    `;
}

function buildText(copy) {
  return `${copy.textIntro}\n${copy.ticket}: {{ticketNumber}}\n{{url}}`;
}

function getTemplate() {
  return {
    templateName: TEMPLATE_NAME,
    subtypeName: SUBTYPE_NAME,
    translations: Object.entries(COPY).map(([lang, copy]) => ({
      language: lang,
      subject: copy.subject,
      htmlContent: buildHtml(copy),
      textContent: buildText(copy),
    })),
  };
}

module.exports = { TEMPLATE_NAME, SUBTYPE_NAME, getTemplate };
