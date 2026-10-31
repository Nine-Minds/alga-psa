// Co-managed L5: global notification catalog rows (lookup seed; no tenant rows, no backfill).
// The rows are global, so the settings listing action hides the `co-managed` category from
// tenants the capability does not serve (packages/notifications internalNotificationActions).
// English only: createNotificationRowFromTemplate falls back to `en` for other locales.
const CATEGORY = { name: 'co-managed', description: 'Shared work with a co-managing organisation' };
const SUBTYPES = [
  { name: 'co-managed-escalation-received', description: 'A customer escalated a ticket to you',
    title: '{{actorName}} escalated ticket #{{ticketNumber}}', message: '{{actorOrganization}} escalated "{{ticketTitle}}" to you.' },
  { name: 'co-managed-escalation-returned', description: 'A ticket was returned to the customer or taken back',
    title: 'Ticket #{{ticketNumber}} was handed back', message: '{{actorName}} ({{actorOrganization}}) handed back "{{ticketTitle}}".' },
  { name: 'co-managed-ticket-assigned', description: 'You were assigned a shared ticket',
    title: 'Shared ticket #{{ticketNumber}} assigned to you', message: '{{actorName}} assigned "{{ticketTitle}}" to you.' },
  { name: 'co-managed-comment-added', description: 'A comment was added to a shared ticket',
    title: 'New comment on shared ticket #{{ticketNumber}}', message: '{{authorName}} commented on "{{ticketTitle}}".' },
];

exports.up = async function up(knex) {
  // migration-lint: allow 8 - co-managed notification catalog rows are new global lookup data (no existing rows touched), idempotent via onConflict ignore
  await knex('internal_notification_categories')
    .insert({ name: CATEGORY.name, description: CATEGORY.description, is_enabled: true, is_default_enabled: true })
    .onConflict(['name']).ignore();
  const category = await knex('internal_notification_categories').where({ name: CATEGORY.name }).first();
  for (const subtype of SUBTYPES) {
    // migration-lint: allow 8 - co-managed notification catalog rows are new global lookup data (no existing rows touched), idempotent via onConflict ignore
    await knex('internal_notification_subtypes')
      .insert({ internal_category_id: category.internal_notification_category_id, name: subtype.name, description: subtype.description,
        is_enabled: true, is_default_enabled: true })
      .onConflict(['internal_category_id', 'name']).ignore();
    const row = await knex('internal_notification_subtypes')
      .where({ internal_category_id: category.internal_notification_category_id, name: subtype.name }).first();
    // migration-lint: allow 8 - co-managed notification catalog rows are new global lookup data (no existing rows touched), idempotent via onConflict ignore
    await knex('internal_notification_templates')
      .insert({ name: subtype.name, language_code: 'en', title: subtype.title, message: subtype.message, subtype_id: row.internal_notification_subtype_id })
      .onConflict(['name', 'language_code']).ignore();
  }
};

exports.down = async function down(knex) {
  await knex('internal_notification_templates').whereIn('name', SUBTYPES.map((s) => s.name)).del();
  await knex('internal_notification_subtypes').whereIn('name', SUBTYPES.map((s) => s.name)).del();
  await knex('internal_notification_categories').where({ name: CATEGORY.name }).del();
};
