/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // System-wide internal notification categories (no RLS)
    .createTable('internal_notification_categories', table => {
      table.increments('internal_notification_category_id').primary();
      table.string('name').notNullable();
      table.string('description');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      table.unique(['name']);
    })

    // System-wide internal notification subtypes (no RLS)
    .createTable('internal_notification_subtypes', table => {
      table.increments('internal_notification_subtype_id').primary();
      table.integer('internal_category_id').notNullable();
      table.string('name').notNullable();
      table.string('description');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.boolean('is_default_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      table.foreign('internal_category_id')
        .references('internal_notification_category_id')
        .inTable('internal_notification_categories')
        .onDelete('CASCADE');
      table.unique(['internal_category_id', 'name']);
    })

    // System-wide internal notification templates (no RLS)
    .createTable('internal_notification_templates', table => {
      table.increments('internal_notification_template_id').primary();
      table.string('name').notNullable(); // e.g., 'ticket-assigned'
      table.string('language_code', 2).notNullable(); // en, fr, es, de, nl, it
      table.text('title').notNullable(); // Notification title in that language
      table.text('message').notNullable(); // Notification message in that language
      table.integer('subtype_id').notNullable();
      table.timestamps(true, true);

      table.foreign('subtype_id')
        .references('internal_notification_subtype_id')
        .inTable('internal_notification_subtypes')
        .onDelete('CASCADE');

      table.unique(['name', 'language_code']);
    })

    // Tenant-specific internal notifications (with RLS)
    .createTable('internal_notifications', table => {
      table.increments('internal_notification_id');
      table.uuid('tenant').notNullable();

      // Composite primary key including tenant for CitusDB
      table.primary(['internal_notification_id', 'tenant']);
      table.uuid('user_id').notNullable();
      table.string('template_name').notNullable(); // Reference to template (e.g., 'ticket-assigned')
      table.string('language_code', 2).notNullable(); // Which language version was used
      table.text('title').notNullable(); // Rendered title from template
      table.text('message').notNullable(); // Rendered message from template
      table.enum('type', ['info', 'success', 'warning', 'error']).notNullable().defaultTo('info'); // For icon/styling
      table.string('category'); // ticket, project, invoice, etc.
      table.text('link'); // Optional URL to related entity
      table.jsonb('metadata'); // Store ticket_id, project_id, etc.
      table.boolean('is_read').notNullable().defaultTo(false);
      table.timestamp('read_at');
      table.timestamp('deleted_at'); // Soft deletion

      // Delivery tracking fields
      table.enum('delivery_status', ['pending', 'delivered', 'failed']).notNullable().defaultTo('pending');
      table.integer('delivery_attempts').notNullable().defaultTo(0);
      table.timestamp('last_delivery_attempt');
      table.text('delivery_error');

      table.timestamps(true, true);

      table.foreign(['tenant', 'user_id'])
        .references(['tenant', 'user_id'])
        .inTable('users')
        .onDelete('CASCADE');
    })

    // Add indexes for performance
    .raw(`
      CREATE INDEX idx_internal_notifications_unread
      ON internal_notifications(tenant, user_id, is_read, created_at DESC)
      WHERE deleted_at IS NULL;

      CREATE INDEX idx_internal_notifications_list
      ON internal_notifications(tenant, user_id, created_at DESC)
      WHERE deleted_at IS NULL;

      CREATE INDEX idx_internal_notifications_cleanup
      ON internal_notifications(deleted_at)
      WHERE deleted_at IS NOT NULL;

      CREATE INDEX idx_internal_notifications_delivery
      ON internal_notifications(delivery_status, delivery_attempts)
      WHERE delivery_status = 'pending' AND delivery_attempts < 3;
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop indexes first
  await knex.raw(`
    DROP INDEX IF EXISTS idx_internal_notifications_delivery;
    DROP INDEX IF EXISTS idx_internal_notifications_cleanup;
    DROP INDEX IF EXISTS idx_internal_notifications_list;
    DROP INDEX IF EXISTS idx_internal_notifications_unread;
  `);

  // Drop tables in reverse order with CASCADE to handle foreign key dependencies
  await knex.raw('DROP TABLE IF EXISTS internal_notifications CASCADE');
  await knex.raw('DROP TABLE IF EXISTS internal_notification_templates CASCADE');
  await knex.raw('DROP TABLE IF EXISTS internal_notification_subtypes CASCADE');
  await knex.raw('DROP TABLE IF EXISTS internal_notification_categories CASCADE');
};
