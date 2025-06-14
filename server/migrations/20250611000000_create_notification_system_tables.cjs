/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Notification types and categories (Global) - CREATE FIRST
    .createTable('internal_notification_types', table => {
      table.uuid('internal_notification_type_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('type_name', 50).notNullable().unique();
      table.string('category_name', 50).notNullable();
      table.timestamps(true, true);
    })

    // Core notifications table for in-app notifications
    .createTable('internal_notifications', table => {
      table.uuid('internal_notification_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.uuid('type_id').notNullable();
      table.string('title', 255).notNullable();
      table.text('message');
      table.jsonb('data');
      table.string('action_url', 500);
      table.uuid('priority_id');
      table.timestamp('read_at');
      table.timestamp('archived_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('expires_at');

      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
      table.foreign('type_id').references('internal_notification_type_id').inTable('internal_notification_types');
      table.foreign('priority_id').references('priority_id').inTable('standard_priorities');
      table.index(['tenant', 'user_id', 'read_at'], 'idx_internal_notifications_tenant_user_unread');
      table.index(['created_at'], 'idx_internal_notifications_created_desc');
    })

    // Direct messages table for user-to-user messaging
    .createTable('direct_messages', table => {
      table.uuid('tenant').notNullable();
      table.uuid('direct_message_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('sender_id').notNullable();
      table.uuid('recipient_id').notNullable();
      table.uuid('thread_id');
      table.text('message').notNullable();
      table.jsonb('attachments');
      table.timestamp('read_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('edited_at');
      table.timestamp('deleted_at');

      table.primary(['tenant', 'direct_message_id']);
      table.foreign(['tenant', 'sender_id']).references(['tenant', 'user_id']).inTable('users');
      table.foreign(['tenant', 'recipient_id']).references(['tenant', 'user_id']).inTable('users');
      table.index(['thread_id'], 'idx_direct_messages_thread');
      table.index(['recipient_id', 'read_at'], 'idx_direct_messages_recipient_unread');
    })

    // Notification preferences (extends existing user_notification_preferences)
    .createTable('internal_notification_preferences', table => {
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.uuid('internal_notification_type_id').notNullable();
      table.string('channel', 20).notNullable(); // 'in_app', 'email', 'sms'
      table.boolean('enabled').defaultTo(true);
      table.time('quiet_hours_start');
      table.time('quiet_hours_end');

      table.primary(['tenant', 'user_id', 'internal_notification_type_id', 'channel']);
      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
      table.foreign(['internal_notification_type_id']).references(['internal_notification_type_id']).inTable('internal_notification_types');
    })

    // Notification templates for different event types (Global)
    .createTable('internal_notification_templates', table => {
      table.uuid('internal_notification_template_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('type_id').notNullable().unique(); // Each type gets one template
      table.string('title_template', 255);
      table.text('message_template');
      table.string('action_template', 500);
      table.uuid('default_priority_id');
      table.jsonb('variables'); // Expected template variables
      table.timestamps(true, true);

      table.foreign('type_id').references('internal_notification_type_id').inTable('internal_notification_types');
      table.foreign('default_priority_id').references('priority_id').inTable('standard_priorities');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('internal_notification_templates')
    .dropTableIfExists('internal_notification_preferences')
    .dropTableIfExists('direct_messages')
    .dropTableIfExists('internal_notifications')
    .dropTableIfExists('internal_notification_types');
};
