/**
 * Adds the RMM Alerts notification category for both delivery channels:
 * - email: notification_categories / notification_subtypes / system_email_templates
 * - in-app: internal_notification_categories / subtypes / templates
 *
 * The shared alert pipeline notifies a matched rule's notifyUserIds through
 * these, honoring per-user preferences.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const CATEGORY_NAME = 'RMM Alerts';
const SUBTYPE_NAME = 'RMM Alert Triggered';
const TEMPLATE_NAME = 'rmm-alert-triggered';

exports.up = async function(knex) {
  // --- Email channel ---
  let category = await knex('notification_categories').where({ name: CATEGORY_NAME }).first();
  if (!category) {
    [category] = await knex('notification_categories')
      .insert({
        name: CATEGORY_NAME,
        description: 'Notifications about alerts from connected RMM platforms',
        is_enabled: true,
        is_default_enabled: true,
      })
      .returning('*');
  }

  let subtype = await knex('notification_subtypes')
    .where({ category_id: category.id, name: SUBTYPE_NAME })
    .first();
  if (!subtype) {
    [subtype] = await knex('notification_subtypes')
      .insert({
        category_id: category.id,
        name: SUBTYPE_NAME,
        description: 'An RMM alert fired and matched a rule that notifies you',
        is_enabled: true,
        is_default_enabled: true,
      })
      .returning('*');
  }

  const existingEmailTemplate = await knex('system_email_templates').where({ name: TEMPLATE_NAME }).first();
  if (!existingEmailTemplate) {
    await knex('system_email_templates').insert({
      name: TEMPLATE_NAME,
      subject: 'RMM Alert ({{severity}}): {{deviceName}}',
      notification_subtype_id: subtype.id,
      html_content: `
      <h2>RMM Alert</h2>
      <p>An alert from {{provider}} matched a rule that notifies you.</p>
      <div class="details">
        <p><strong>Severity:</strong> {{severity}}</p>
        <p><strong>Device:</strong> {{deviceName}}</p>
        <p><strong>Message:</strong> {{message}}</p>
        <p><strong>Ticket:</strong> {{ticketNumber}}</p>
      </div>
      <p><a href="{{url}}">View in Alga PSA</a></p>
    `,
      text_content: `RMM Alert ({{severity}}) on {{deviceName}}: {{message}}\nTicket: {{ticketNumber}}\n{{url}}`,
    });
  }

  // --- In-app channel ---
  let internalCategory = await knex('internal_notification_categories').where({ name: CATEGORY_NAME }).first();
  if (!internalCategory) {
    [internalCategory] = await knex('internal_notification_categories')
      .insert({
        name: CATEGORY_NAME,
        description: 'Notifications about alerts from connected RMM platforms',
        is_enabled: true,
        is_default_enabled: true,
      })
      .returning('*');
  }

  let internalSubtype = await knex('internal_notification_subtypes')
    .where({
      internal_category_id: internalCategory.internal_notification_category_id,
      name: SUBTYPE_NAME,
    })
    .first();
  if (!internalSubtype) {
    [internalSubtype] = await knex('internal_notification_subtypes')
      .insert({
        internal_category_id: internalCategory.internal_notification_category_id,
        name: SUBTYPE_NAME,
        description: 'An RMM alert fired and matched a rule that notifies you',
        is_enabled: true,
        is_default_enabled: true,
      })
      .returning('*');
  }

  await knex('internal_notification_templates')
    .insert({
      name: TEMPLATE_NAME,
      language_code: 'en',
      title: 'RMM Alert ({{severity}}): {{deviceName}}',
      message: '{{message}}',
      subtype_id: internalSubtype.internal_notification_subtype_id,
    })
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id'),
    });
};

exports.down = async function(knex) {
  await knex('internal_notification_templates').where({ name: TEMPLATE_NAME }).delete();
  const internalCategory = await knex('internal_notification_categories').where({ name: CATEGORY_NAME }).first();
  if (internalCategory) {
    await knex('internal_notification_subtypes')
      .where({ internal_category_id: internalCategory.internal_notification_category_id })
      .delete();
    await knex('internal_notification_categories')
      .where({ internal_notification_category_id: internalCategory.internal_notification_category_id })
      .delete();
  }

  await knex('system_email_templates').where({ name: TEMPLATE_NAME }).delete();
  const category = await knex('notification_categories').where({ name: CATEGORY_NAME }).first();
  if (category) {
    await knex('notification_subtypes').where({ category_id: category.id }).delete();
    await knex('notification_categories').where({ id: category.id }).delete();
  }
};
