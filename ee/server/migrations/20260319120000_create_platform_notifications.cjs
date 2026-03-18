/**
 * Creates platform notification tables for cross-tenant announcements/alerts.
 *
 * platform_notifications: Notification content (reference table, replicated to all nodes).
 *   No tenant column — there is only one platform.
 *
 * platform_notification_recipients: Materialized recipient list with per-user read state.
 *   Distributed by user's tenant, colocated with tenants.
 *   Populated at notification create/update time from resolved filters.
 */

exports.up = async function up(knex) {
  // ── platform_notifications (reference table) ──
  await knex.schema.createTable('platform_notifications', (table) => {
    table.uuid('notification_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('title', 255).notNullable();
    table.text('banner_content').notNullable();
    table.text('detail_content').notNullable();
    table.jsonb('target_audience').notNullable().defaultTo(JSON.stringify({ filters: {} }));
    table.string('priority', 20).notNullable().defaultTo('info');
    table.timestamp('starts_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at').nullable();
    table.uuid('created_by').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.boolean('is_active').notNullable().defaultTo(true);

    table.primary(['notification_id'], {
      constraintName: 'platform_notifications_pk',
    });
  });

  // ── platform_notification_recipients (materialized join table) ──
  await knex.schema.createTable('platform_notification_recipients', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('notification_id').notNullable();
    table.uuid('user_id').notNullable();
    table.timestamp('matched_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('excluded_at').nullable();       // non-null = admin excluded after resolution
    table.timestamp('dismissed_at').nullable();       // non-null = user dismissed the banner
    table.timestamp('detail_viewed_at').nullable();   // non-null = user clicked "Learn More"

    table.primary(['tenant', 'notification_id', 'user_id'], {
      constraintName: 'platform_notification_recipients_pk',
    });

    // FK to reference table — supported by Citus for distributed → reference
    table.foreign('notification_id', 'platform_notification_recipients_notif_fk')
      .references('notification_id')
      .inTable('platform_notifications')
      .onDelete('CASCADE');
  });

  // ── Citus distribution ──
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') as enabled
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    // platform_notifications: reference table (small, rarely written, needed by all shards)
    const isNotifDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'platform_notifications'::regclass
      ) as distributed
    `);

    if (!isNotifDistributed.rows?.[0]?.distributed) {
      await knex.raw(`SELECT create_reference_table('platform_notifications')`);
    }

    // platform_notification_recipients: distributed by user's tenant
    const isRecipDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'platform_notification_recipients'::regclass
      ) as distributed
    `);

    if (!isRecipDistributed.rows?.[0]?.distributed) {
      await knex.raw(`
        SELECT create_distributed_table('platform_notification_recipients', 'tenant', colocate_with => 'tenants')
      `);
    }
  }

  // ── Indexes for platform_notifications ──
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS platform_notifications_active_idx
      ON platform_notifications (starts_at) WHERE is_active = true;
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS platform_notifications_expires_idx
      ON platform_notifications (expires_at)
      WHERE is_active = true AND expires_at IS NOT NULL;
  `);

  // ── Indexes for platform_notification_recipients ──
  // User-facing: "what notifications does this user have?"
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS platform_notification_recipients_user_idx
      ON platform_notification_recipients (tenant, user_id)
      WHERE excluded_at IS NULL AND dismissed_at IS NULL;
  `);

  // Admin stats: "who received this notification?"
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS platform_notification_recipients_notif_idx
      ON platform_notification_recipients (notification_id)
      WHERE excluded_at IS NULL;
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('platform_notification_recipients');
  await knex.schema.dropTableIfExists('platform_notifications');
};

exports.config = { transaction: false };
