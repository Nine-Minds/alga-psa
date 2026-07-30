'use strict';

/**
 * Ship the newly added translations for the locale-gapped templates and the
 * missing pt/pl rows for the inline-defined ones.
 *
 * The opportunity email digest and the internal opportunity templates only had
 * English copy; they now carry every supported locale. The RMM alert and the
 * two inventory internal templates were defined inline in their own migrations
 * missing pt (and the RMM templates were English-only, so fr/es/de/nl/it/pl
 * are missing there too). This migration upserts all of those rows, merging on
 * (name, language_code), so it is idempotent and a no-op once every row
 * matches the source of truth.
 */

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { getTemplate: opportunityWeeklyDigest } = require('./utils/templates/email/opportunities/opportunityWeeklyDigest.cjs');
const { TEMPLATES: opportunityInternalTemplates } = require('./utils/templates/internal/opportunities.cjs');

const RMM_ALERT_EMAIL_TRANSLATIONS = [
  {
    language: 'fr',
    subject: 'Alerte RMM ({{severity}}) : {{deviceName}}',
    htmlContent: `
      <h2>Alerte RMM</h2>
      <p>Une alerte de {{provider}} correspond à une règle qui vous notifie.</p>
      <div class="details">
        <p><strong>Gravité :</strong> {{severity}}</p>
        <p><strong>Appareil :</strong> {{deviceName}}</p>
        <p><strong>Message :</strong> {{message}}</p>
        <p><strong>Ticket :</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">Voir dans Alga PSA</a></p>
    `,
    textContent: 'Alerte RMM ({{severity}}) sur {{deviceName}} : {{message}}\nTicket : {{ticketNumber}}\n{{url}}',
  },
  {
    language: 'es',
    subject: 'Alerta de RMM ({{severity}}): {{deviceName}}',
    htmlContent: `
      <h2>Alerta de RMM</h2>
      <p>Una alerta de {{provider}} coincide con una regla que te notifica.</p>
      <div class="details">
        <p><strong>Severidad:</strong> {{severity}}</p>
        <p><strong>Dispositivo:</strong> {{deviceName}}</p>
        <p><strong>Mensaje:</strong> {{message}}</p>
        <p><strong>Ticket:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">Ver en Alga PSA</a></p>
    `,
    textContent: 'Alerta de RMM ({{severity}}) en {{deviceName}}: {{message}}\nTicket: {{ticketNumber}}\n{{url}}',
  },
  {
    language: 'de',
    subject: 'RMM-Warnung ({{severity}}): {{deviceName}}',
    htmlContent: `
      <h2>RMM-Warnung</h2>
      <p>Eine Warnung von {{provider}} entspricht einer Regel, die Sie benachrichtigt.</p>
      <div class="details">
        <p><strong>Schweregrad:</strong> {{severity}}</p>
        <p><strong>Gerät:</strong> {{deviceName}}</p>
        <p><strong>Nachricht:</strong> {{message}}</p>
        <p><strong>Ticket:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">In Alga PSA ansehen</a></p>
    `,
    textContent: 'RMM-Warnung ({{severity}}) auf {{deviceName}}: {{message}}\nTicket: {{ticketNumber}}\n{{url}}',
  },
  {
    language: 'nl',
    subject: 'RMM-melding ({{severity}}): {{deviceName}}',
    htmlContent: `
      <h2>RMM-melding</h2>
      <p>Een melding van {{provider}} komt overeen met een regel die jou waarschuwt.</p>
      <div class="details">
        <p><strong>Ernst:</strong> {{severity}}</p>
        <p><strong>Apparaat:</strong> {{deviceName}}</p>
        <p><strong>Bericht:</strong> {{message}}</p>
        <p><strong>Ticket:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">Bekijk in Alga PSA</a></p>
    `,
    textContent: 'RMM-melding ({{severity}}) op {{deviceName}}: {{message}}\nTicket: {{ticketNumber}}\n{{url}}',
  },
  {
    language: 'it',
    subject: 'Avviso RMM ({{severity}}): {{deviceName}}',
    htmlContent: `
      <h2>Avviso RMM</h2>
      <p>Un avviso da {{provider}} corrisponde a una regola che ti avvisa.</p>
      <div class="details">
        <p><strong>Gravità:</strong> {{severity}}</p>
        <p><strong>Dispositivo:</strong> {{deviceName}}</p>
        <p><strong>Messaggio:</strong> {{message}}</p>
        <p><strong>Ticket:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">Visualizza in Alga PSA</a></p>
    `,
    textContent: 'Avviso RMM ({{severity}}) su {{deviceName}}: {{message}}\nTicket: {{ticketNumber}}\n{{url}}',
  },
  {
    language: 'pl',
    subject: 'Alert RMM ({{severity}}): {{deviceName}}',
    htmlContent: `
      <h2>Alert RMM</h2>
      <p>Alert z {{provider}} pasuje do reguły, która Cię powiadamia.</p>
      <div class="details">
        <p><strong>Ważność:</strong> {{severity}}</p>
        <p><strong>Urządzenie:</strong> {{deviceName}}</p>
        <p><strong>Wiadomość:</strong> {{message}}</p>
        <p><strong>Zgłoszenie:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">Zobacz w Alga PSA</a></p>
    `,
    textContent: 'Alert RMM ({{severity}}) na {{deviceName}}: {{message}}\nZgłoszenie: {{ticketNumber}}\n{{url}}',
  },
  {
    language: 'pt',
    subject: 'Alerta de RMM ({{severity}}): {{deviceName}}',
    htmlContent: `
      <h2>Alerta de RMM</h2>
      <p>Um alerta de {{provider}} correspondeu a uma regra que o notifica.</p>
      <div class="details">
        <p><strong>Severidade:</strong> {{severity}}</p>
        <p><strong>Dispositivo:</strong> {{deviceName}}</p>
        <p><strong>Mensagem:</strong> {{message}}</p>
        <p><strong>Ticket:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">Ver no Alga PSA</a></p>
    `,
    textContent: 'Alerta de RMM ({{severity}}) em {{deviceName}}: {{message}}\nTicket: {{ticketNumber}}\n{{url}}',
  },
];

const INVENTORY_INTERNAL_TRANSLATIONS = {
  'inventory-low-stock': {
    pl: {
      title: 'Niski stan magazynowy w {{locationName}}',
      message: '{{productCount}} produkt(ów) w {{locationName}} osiągnęło lub spadło poniżej punktu zamawiania: {{summary}}',
    },
    pt: {
      title: 'Estoque baixo em {{locationName}}',
      message: '{{productCount}} produto(s) em {{locationName}} estão no ponto de reposição ou abaixo dele: {{summary}}',
    },
  },
  'inventory-po-received': {
    pl: {
      title: 'Zamówienie zakupu {{poNumber}} odebrane',
      message: 'Odebrano {{receivedLineCount}} pozycję(i) od {{vendorName}}.',
    },
    pt: {
      title: 'Pedido de compra {{poNumber}} recebido',
      message: '{{receivedLineCount}} linha(s) recebida(s) de {{vendorName}}.',
    },
  },
};

const RMM_ALERT_INTERNAL_TRANSLATIONS = {
  fr: {
    title: 'Alerte RMM ({{severity}}) : {{deviceName}}',
    message: '{{message}}',
  },
  es: {
    title: 'Alerta de RMM ({{severity}}): {{deviceName}}',
    message: '{{message}}',
  },
  de: {
    title: 'RMM-Warnung ({{severity}}): {{deviceName}}',
    message: '{{message}}',
  },
  nl: {
    title: 'RMM-melding ({{severity}}): {{deviceName}}',
    message: '{{message}}',
  },
  it: {
    title: 'Avviso RMM ({{severity}}): {{deviceName}}',
    message: '{{message}}',
  },
  pl: {
    title: 'Alert RMM ({{severity}}): {{deviceName}}',
    message: '{{message}}',
  },
  pt: {
    title: 'Alerta de RMM ({{severity}}): {{deviceName}}',
    message: '{{message}}',
  },
};

async function upsertRmmAlertEmailTranslations(knex) {
  const subtype = await knex('notification_subtypes').where({ name: 'RMM Alert Triggered' }).first();
  if (!subtype) {
    throw new Error("Notification subtype 'RMM Alert Triggered' not found for template 'rmm-alert-triggered'");
  }
  const now = new Date();
  const rows = RMM_ALERT_EMAIL_TRANSLATIONS.map((t) => ({
    name: 'rmm-alert-triggered',
    language_code: t.language,
    subject: t.subject,
    html_content: t.htmlContent,
    text_content: t.textContent,
    notification_subtype_id: subtype.id,
    updated_at: now,
  }));
  await knex('system_email_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge(['subject', 'html_content', 'text_content', 'notification_subtype_id', 'updated_at']);
}

async function upsertInlineInternalTranslations(knex) {
  const now = new Date();
  const specs = [
    { name: 'inventory-low-stock', subtypeName: 'inventory-low-stock', translations: INVENTORY_INTERNAL_TRANSLATIONS['inventory-low-stock'] },
    { name: 'inventory-po-received', subtypeName: 'inventory-po-received', translations: INVENTORY_INTERNAL_TRANSLATIONS['inventory-po-received'] },
    { name: 'rmm-alert-triggered', subtypeName: 'RMM Alert Triggered', translations: RMM_ALERT_INTERNAL_TRANSLATIONS },
  ];
  for (const spec of specs) {
    const subtype = await knex('internal_notification_subtypes').where({ name: spec.subtypeName }).first();
    if (!subtype) {
      throw new Error(`Internal notification subtype '${spec.subtypeName}' not found for template '${spec.name}'`);
    }
    const rows = Object.entries(spec.translations).map(([language_code, t]) => ({
      name: spec.name,
      language_code,
      title: t.title,
      message: t.message,
      subtype_id: subtype.internal_notification_subtype_id,
    }));
    await knex('internal_notification_templates')
      .insert(rows)
      .onConflict(['name', 'language_code'])
      .merge({ title: knex.raw('excluded.title'), message: knex.raw('excluded.message'), subtype_id: knex.raw('excluded.subtype_id') });
  }
}

exports.up = async function up(knex) {
  // Module-defined templates now carry every supported locale; re-upsert them.
  await upsertEmailTemplate(knex, opportunityWeeklyDigest());
  await upsertInternalTemplates(knex, opportunityInternalTemplates);

  // Inline-defined templates: add the missing pt/pl rows.
  await upsertRmmAlertEmailTranslations(knex);
  await upsertInlineInternalTranslations(knex);

  console.log('Added missing locale rows for opportunity, RMM alert, and inventory templates.');
};

exports.down = async function down() {
  // No-op: template migrations are forward-only content corrections.
};
