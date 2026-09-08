const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const EVENTS = 'co_management_ticket_routing_events', RECIPIENTS = 'co_management_ticket_routing_recipients';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(EVENTS)) await knex.schema.createTable(EVENTS, table => {
    table.uuid('tenant').notNullable(); table.uuid('event_id').notNullable();
    // Source identity is soft: departure/deletion must not cascade across tenants.
    table.uuid('customer_tenant').notNullable(); table.uuid('relationship_id').notNullable(); table.uuid('ticket_id').notNullable();
    table.uuid('actor_tenant').notNullable(); table.uuid('actor_user_id').notNullable();
    table.integer('work_revision').notNullable(); table.text('transition').notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });
    table.primary(['tenant', 'event_id']); table.index(['tenant', 'status', 'created_at']);
    table.check("transition IN ('escalated', 'handed_back', 'assigned') AND work_revision > 0");
    table.check("(status = 'pending' AND completed_at IS NULL) OR (status = 'completed' AND completed_at IS NOT NULL)");
  });
  await ensureTenantDistribution(knex, EVENTS);
  if (!await knex.schema.hasTable(RECIPIENTS)) await knex.schema.createTable(RECIPIENTS, table => {
    table.uuid('tenant').notNullable(); table.uuid('event_id').notNullable(); table.uuid('recipient_user_id').notNullable();
    table.text('channel').notNullable(); table.text('status').notNullable().defaultTo('pending'); table.uuid('notification_id');
    table.integer('attempt_count').notNullable().defaultTo(0); table.text('error_code');
    table.timestamp('next_attempt_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });
    table.primary(['tenant', 'event_id', 'recipient_user_id', 'channel']); table.unique(['tenant', 'notification_id']);
    table.index(['tenant', 'channel', 'status', 'next_attempt_at']);
    table.check("channel IN ('in_app', 'email') AND status IN ('pending', 'created', 'disabled', 'delivered', 'skipped', 'failed') AND attempt_count >= 0");
    table.check("(status = 'created' AND channel = 'in_app' AND notification_id IS NOT NULL) OR (status <> 'created' AND notification_id IS NULL)");
    table.check("(status = 'pending' AND completed_at IS NULL) OR (status <> 'pending' AND completed_at IS NOT NULL)");
  });
  await ensureTenantDistribution(knex, RECIPIENTS);
  const foreignKey = 'co_managed_routing_recipient_event_fk';
  if (!await knex('pg_constraint').where('conname', foreignKey).whereRaw('conrelid = ?::regclass', [RECIPIENTS]).first())
    await knex.schema.alterTable(RECIPIENTS, table => table.foreign(['tenant', 'event_id'], foreignKey)
      .references(['tenant', 'event_id']).inTable(EVENTS).onDelete('CASCADE'));
  // Fresh installs may not have optional notification seed rows yet.
  await knex('internal_notification_categories').insert({ name: 'tickets', description: 'Ticket-related notifications',
    is_enabled: true, is_default_enabled: true }).onConflict('name').ignore();
  const category = await knex('internal_notification_categories').where('name', 'tickets').first();
  await knex('internal_notification_subtypes').insert({ name: 'ticket-assigned', internal_category_id: category.internal_notification_category_id,
    description: 'Ticket assignment notifications', is_enabled: true, is_default_enabled: true })
    .onConflict(['internal_category_id', 'name']).ignore();
  const subtype = await knex('internal_notification_subtypes').where({ name: 'ticket-assigned', internal_category_id: category.internal_notification_category_id }).first();
  for (const [transition, title, verb] of [
    ['escalated', 'Ticket escalated to your MSP', 'has been escalated to your MSP'],
    ['handed_back', 'Ticket handed back to your organization', 'has been handed back to your organization'],
    ['assigned', 'Co-managed ticket assigned', 'has been assigned to you or your team'],
  ]) await knex('internal_notification_templates').insert({ name: `co-managed-ticket-${transition}`, language_code: 'en', title,
    message: `Ticket #{{ticketNumber}} "{{ticketTitle}}" ${verb}.`, subtype_id: subtype.internal_notification_subtype_id })
    .onConflict(['name', 'language_code']).ignore();
};
exports.down = async function(knex) {
  if (await knex(EVENTS).first() || await knex(RECIPIENTS).first()) throw new Error('Cannot discard retained co-managed routing notifications');
  await knex.schema.dropTableIfExists(RECIPIENTS); await knex.schema.dropTableIfExists(EVENTS);
  await knex('internal_notification_templates').whereIn('name', ['co-managed-ticket-escalated', 'co-managed-ticket-handed_back', 'co-managed-ticket-assigned']).delete();
};
exports.config = { transaction: false };
