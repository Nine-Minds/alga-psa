/**
 * Minimal user-generated-content moderation surface for the mobile app.
 * Satisfies App Store guideline 1.2 (report + block / mute mechanisms).
 *
 *   - content_reports: append-only log of user-submitted reports. Feeds an
 *     abuse mailbox; not consumed by the app itself.
 *   - user_content_mutes: per-user block list. The mobile app fetches this
 *     on sign-in and filters muted authors from comment lists.
 *
 * Both are distributed by tenant to match the existing tables they join on.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasReports = await knex.schema.hasTable('content_reports');
  if (!hasReports) {
    await knex.schema.createTable('content_reports', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('content_report_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('reporter_user_id').notNullable();
      table.text('content_type').notNullable(); // 'ticket_comment' | 'ticket_description'
      table.text('content_id').nullable();       // comment_id or ticket_id
      table.uuid('content_author_user_id').nullable();
      table.text('reason').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('resolved_at').nullable();
      table.text('resolution_note').nullable();

      table.primary(['tenant', 'content_report_id']);
      table.index(['tenant', 'created_at']);
      table.index(['tenant', 'content_type', 'content_id']);
    });
  }

  const hasMutes = await knex.schema.hasTable('user_content_mutes');
  if (!hasMutes) {
    await knex.schema.createTable('user_content_mutes', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();       // the user doing the muting
      table.uuid('muted_user_id').notNullable(); // the user being muted
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'user_id', 'muted_user_id']);
      table.index(['tenant', 'user_id']);
    });
  }

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const reportsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'content_reports'::regclass
      ) AS is_distributed;
    `);
    if (!reportsDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(
        "SELECT create_distributed_table('content_reports', 'tenant', colocate_with => 'tenants')",
      );
    }

    const mutesDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'user_content_mutes'::regclass
      ) AS is_distributed;
    `);
    if (!mutesDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(
        "SELECT create_distributed_table('user_content_mutes', 'tenant', colocate_with => 'tenants')",
      );
    }
  } else {
    console.warn('[add_content_moderation] Skipping Citus distribution (functions unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_content_mutes');
  await knex.schema.dropTableIfExists('content_reports');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };
