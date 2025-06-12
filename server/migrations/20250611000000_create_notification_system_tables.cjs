/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Core notifications table for in-app notifications
    .createTable('notifications', table => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.integer('user_id').notNullable();
      table.string('type', 50).notNullable();
      table.string('category', 50).notNullable();
      table.string('title', 255).notNullable();
      table.text('message');
      table.jsonb('data');
      table.string('action_url', 500);
      table.string('priority', 20).defaultTo('normal'); // 'low', 'normal', 'high', 'urgent'
      table.timestamp('read_at');
      table.timestamp('archived_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('expires_at');

      table.primary(['tenant', 'id']);
      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
      table.index(['tenant', 'user_id', 'read_at'], 'idx_notifications_tenant_user_unread');
      table.index(['created_at'], 'idx_notifications_created_desc');
    })

    // Direct messages table for user-to-user messaging
    .createTable('direct_messages', table => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.integer('sender_id').notNullable();
      table.integer('recipient_id').notNullable();
      table.uuid('thread_id');
      table.text('message').notNullable();
      table.jsonb('attachments');
      table.timestamp('read_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('edited_at');
      table.timestamp('deleted_at');

      table.primary(['tenant', 'id']);
      table.foreign(['tenant', 'sender_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
      table.foreign(['tenant', 'recipient_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
      table.index(['thread_id'], 'idx_direct_messages_thread');
      table.index(['recipient_id', 'read_at'], 'idx_direct_messages_recipient_unread');
    })

    // Notification preferences (extends existing user_notification_preferences)
    .createTable('notification_preferences_v2', table => {
      table.uuid('tenant').notNullable();
      table.integer('user_id').notNullable();
      table.string('notification_type', 50).notNullable();
      table.string('channel', 20).notNullable(); // 'in_app', 'email', 'sms'
      table.boolean('enabled').defaultTo(true);
      table.time('quiet_hours_start');
      table.time('quiet_hours_end');

      table.primary(['tenant', 'user_id', 'notification_type', 'channel']);
      table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users').onDelete('CASCADE');
    })

    // Notification templates for different event types
    .createTable('notification_templates_v2', table => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('type', 50).notNullable();
      table.string('title_template', 255);
      table.text('message_template');
      table.string('action_template', 500);
      table.string('default_priority', 20);
      table.jsonb('variables'); // Expected template variables

      table.primary(['tenant', 'id']);
      table.unique(['tenant', 'type']);
      table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('notification_templates_v2')
    .dropTableIfExists('notification_preferences_v2')
    .dropTableIfExists('direct_messages')
    .dropTableIfExists('notifications');
};