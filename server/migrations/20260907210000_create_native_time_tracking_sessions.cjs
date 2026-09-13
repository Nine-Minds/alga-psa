const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'native_time_tracking_sessions';
exports.up = async function(knex) {
  // Standard time entries require an end instant. Customized installations must
  // reconcile ambiguous unfinished rows before changing their representation.
  if (await knex('time_entries').whereNull('end_time').first()) throw new Error('Reconcile legacy unfinished time entries before migrating timers');
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('session_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable();
    table.uuid('work_item_id').nullable();
    table.string('work_item_type', 32).notNullable();
    table.timestamp('start_time', { useTz: true }).notNullable();
    table.date('work_date').notNullable();
    table.text('work_timezone').notNullable();
    table.string('billing_mode', 16).notNullable();
    table.uuid('service_id').nullable();
    table.text('notes').notNullable().defaultTo('');
    table.uuid('completed_entry_id').nullable();
    table.timestamp('stopped_at', { useTz: true }).nullable();
    table.string('stop_request_hash', 64).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'session_id']);
    table.check("work_item_type IN ('ticket', 'project_task', 'ad_hoc', 'interaction', 'non_billable_category')");
    table.check("work_item_id IS NOT NULL OR work_item_type = 'non_billable_category'");
    table.check("(billing_mode = 'operational' AND service_id IS NULL) OR (billing_mode = 'commercial' AND service_id IS NOT NULL)");
    table.check("(completed_entry_id IS NULL AND stopped_at IS NULL AND stop_request_hash IS NULL) OR (completed_entry_id IS NOT NULL AND stop_request_hash IS NOT NULL AND completed_entry_id = session_id AND stopped_at IS NOT NULL AND stopped_at >= start_time AND stop_request_hash ~ '^[0-9a-f]{64}$')");
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'native_timer_user_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first())
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant', 'user_id'], 'native_timer_user_fk').references(['tenant', 'user_id']).inTable('users'));
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS native_timer_one_active_user ON ?? (tenant, user_id) WHERE completed_entry_id IS NULL', [TABLE]);
  await knex.raw(`CREATE OR REPLACE FUNCTION preserve_native_time_tracking_session() RETURNS trigger AS $$
    DECLARE product text; saved record;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        SELECT product_code INTO product FROM tenants WHERE tenant = NEW.tenant FOR SHARE;
        IF product = 'co_managed' THEN NEW.billing_mode := 'operational'; END IF;
      ELSE
        IF ROW(NEW.tenant, NEW.session_id, NEW.user_id, NEW.work_item_id, NEW.work_item_type, NEW.start_time, NEW.work_date, NEW.work_timezone, NEW.billing_mode, NEW.service_id, NEW.created_at)
          IS DISTINCT FROM ROW(OLD.tenant, OLD.session_id, OLD.user_id, OLD.work_item_id, OLD.work_item_type, OLD.start_time, OLD.work_date, OLD.work_timezone, OLD.billing_mode, OLD.service_id, OLD.created_at) THEN
          RAISE EXCEPTION 'Timer ownership, source and original billing mode are immutable' USING ERRCODE = '23514', CONSTRAINT = 'native_timer_identity_immutable';
        END IF;
        IF OLD.completed_entry_id IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'Timer completion receipts are immutable' USING ERRCODE = '23514', CONSTRAINT = 'native_timer_completion_immutable';
        END IF;
      END IF;
      IF NEW.completed_entry_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.completed_entry_id IS NULL) THEN
        SELECT user_id, billing_mode, start_time, end_time, work_item_id, work_item_type INTO saved FROM time_entries
          WHERE tenant = NEW.tenant AND entry_id = NEW.completed_entry_id FOR SHARE;
        IF NOT FOUND OR ROW(saved.user_id, saved.billing_mode, saved.start_time, saved.end_time, saved.work_item_id, saved.work_item_type)
          IS DISTINCT FROM ROW(NEW.user_id, NEW.billing_mode, NEW.start_time, NEW.stopped_at, NEW.work_item_id, NEW.work_item_type) THEN
          RAISE EXCEPTION 'Timer completion must reference its own completed effort' USING ERRCODE = '23514', CONSTRAINT = 'native_timer_completed_effort';
        END IF;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw('DROP TRIGGER IF EXISTS preserve_native_time_tracking_session ON ??', [TABLE]);
    await knex.raw('CREATE TRIGGER preserve_native_time_tracking_session BEFORE INSERT OR UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION preserve_native_time_tracking_session()', [TABLE]);
  }
};
exports.down = async function(knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained timer clocks or completion receipts');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS preserve_native_time_tracking_session()');
};
exports.config = { transaction: false };
