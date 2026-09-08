const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_meeting_creation_operations';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('operation_id').notNullable();
    table.uuid('appointment_request_id').notNullable();
    table.uuid('requested_by').notNullable();
    table.text('credential_kind').notNullable();
    table.uuid('credential_id').notNullable();
    table.text('purpose').notNullable();
    table.jsonb('approval_input').notNullable();
    table.text('request_fingerprint').notNullable();
    table.jsonb('creation_target').notNullable();
    table.jsonb('provider_request').notNullable();
    table.text('status').notNullable().defaultTo('prepared');
    table.jsonb('event_receipt').nullable();
    table.text('provider_meeting_id').nullable();
    table.uuid('meeting_id').nullable();
    table.timestamp('external_attempted_at', { useTz: true }).nullable();
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.text('last_error_code').nullable();
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'operation_id']);
    table.check("credential_kind IN ('session', 'api_key') AND purpose IN ('approve', 'generate')");
    table.check("status IN ('prepared', 'uncertain', 'created', 'attached', 'cleanup_pending', 'cleaned', 'failed', 'abandoned')");
    table.check("request_fingerprint ~ '^[0-9a-f]{64}$' AND attempt_count >= 0");
    table.check("jsonb_typeof(approval_input) = 'object' AND jsonb_typeof(creation_target) = 'object' AND jsonb_typeof(provider_request) = 'object'");
    table.check("status NOT IN ('created', 'attached') OR (event_receipt IS NOT NULL AND jsonb_typeof(event_receipt) = 'object')");
    table.check("status <> 'attached' OR (meeting_id IS NOT NULL AND provider_meeting_id IS NOT NULL)");
    table.check("status <> 'abandoned' OR external_attempted_at IS NULL");
    table.check("(status IN ('attached', 'cleaned', 'abandoned')) = (completed_at IS NOT NULL)");
  });
  // No request/user FK: recovery must survive deletion of its source or author.
  await ensureTenantDistribution(knex, TABLE);
  await knex.raw("CREATE UNIQUE INDEX IF NOT EXISTS co_managed_meeting_creation_active_request ON ?? (tenant, appointment_request_id) WHERE status NOT IN ('attached', 'cleaned', 'abandoned')", [TABLE]);
  await knex.raw("CREATE INDEX IF NOT EXISTS co_managed_meeting_creation_due ON ?? (tenant, next_attempt_at, operation_id) WHERE completed_at IS NULL", [TABLE]);
  await knex.raw(`CREATE OR REPLACE FUNCTION preserve_co_managed_meeting_creation_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF ROW(NEW.tenant, NEW.operation_id, NEW.appointment_request_id, NEW.requested_by, NEW.credential_kind, NEW.credential_id, NEW.purpose, NEW.approval_input, NEW.request_fingerprint, NEW.creation_target, NEW.provider_request, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.tenant, OLD.operation_id, OLD.appointment_request_id, OLD.requested_by, OLD.credential_kind, OLD.credential_id, OLD.purpose, OLD.approval_input, OLD.request_fingerprint, OLD.creation_target, OLD.provider_request, OLD.created_at) THEN
      RAISE EXCEPTION 'Meeting creation identity and disclosure payload are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END $$`);
  await knex.raw('DROP TRIGGER IF EXISTS preserve_co_managed_meeting_creation_identity ON ??', [TABLE]);
  await knex.raw('CREATE TRIGGER preserve_co_managed_meeting_creation_identity BEFORE UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION preserve_co_managed_meeting_creation_identity()', [TABLE]);
};
exports.down = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) return;
  if (await knex(TABLE).first('operation_id')) throw new Error('Cannot discard retained meeting creation operations');
  await knex.schema.dropTable(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS preserve_co_managed_meeting_creation_identity()');
};
