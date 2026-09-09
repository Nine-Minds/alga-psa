const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'portable_workspace_restore_uploads';
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    // The destination tenant may not exist yet. Do not add a tenants FK.
    table.uuid('tenant').notNullable(); table.uuid('attempt_id').notNullable();
    table.primary(['tenant', 'attempt_id']);
    table.uuid('package_id').notNullable(); table.text('archive_sha256').notNullable();
    table.text('provider_identity').notNullable(); table.jsonb('file_ids').notNullable();
    table.text('status').notNullable().defaultTo('uploading');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable().defaultTo(knex.raw("clock_timestamp() + interval '35 minutes'"));
    table.timestamp('next_cleanup_at', { useTz: true }).notNullable().defaultTo(knex.raw("clock_timestamp() + interval '35 minutes'"));
    table.timestamp('cleaned_at', { useTz: true }); table.uuid('cleanup_claim');
    table.integer('cleanup_attempts').notNullable().defaultTo(0); table.text('cleanup_error_code');
    table.check("status IN ('uploading', 'committed', 'abandoned') AND archive_sha256 ~ '^[0-9a-f]{64}$' AND provider_identity ~ '^[0-9a-f]{64}$' AND jsonb_typeof(file_ids) = 'array' AND jsonb_array_length(file_ids) <= 100000 AND expires_at > created_at AND cleanup_attempts >= 0");
    table.index(['tenant', 'provider_identity', 'status', 'next_cleanup_at'], 'portable_restore_upload_cleanup_idx');
  });
  await ensureTenantDistribution(knex, TABLE);
  await knex.raw('CREATE INDEX IF NOT EXISTS portable_restore_file_path_idx ON external_files (tenant, storage_path)');
  await knex.raw(`CREATE OR REPLACE FUNCTION portable_restore_upload_transition() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ROW(NEW.tenant, NEW.attempt_id, NEW.package_id, NEW.archive_sha256, NEW.provider_identity, NEW.file_ids, NEW.created_at, NEW.expires_at)
        IS DISTINCT FROM ROW(OLD.tenant, OLD.attempt_id, OLD.package_id, OLD.archive_sha256, OLD.provider_identity, OLD.file_ids, OLD.created_at, OLD.expires_at)
        OR (OLD.status <> NEW.status AND NOT (OLD.status = 'uploading' AND NEW.status IN ('committed', 'abandoned')))
        OR (OLD.status = 'committed' AND NEW IS DISTINCT FROM OLD)
      THEN RAISE EXCEPTION 'Invalid portable restore upload transition' USING ERRCODE = '23514'; END IF;
      RETURN NEW;
    END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS portable_restore_upload_transition ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER portable_restore_upload_transition BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION portable_restore_upload_transition()`);
  }
  // Every native writer must retain the attempt fence before publishing a
  // reference. Otherwise a copy inserted after cleanup's check could point at
  // an object concurrently being deleted. Unjournaled legacy paths are outside
  // this sweep's scope and remain compatible.
  await knex.raw(`CREATE OR REPLACE FUNCTION portable_restore_file_reference_fence() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE parts text[]; attempt_status text;
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW.tenant IS NOT DISTINCT FROM OLD.tenant AND NEW.storage_path IS NOT DISTINCT FROM OLD.storage_path THEN RETURN NEW; END IF;
      parts := regexp_match(NEW.storage_path, '^/{0,1}([0-9a-f-]{36})/portable-restores/([0-9a-f-]{36})/([0-9a-f-]{36})$');
      IF parts IS NULL THEN RETURN NEW; END IF;
      IF NEW.tenant <> parts[1]::uuid THEN
        RAISE EXCEPTION 'Portable restore object cannot acquire a foreign native reference' USING ERRCODE = '23514';
      END IF;
      SELECT status INTO attempt_status FROM portable_workspace_restore_uploads
        WHERE tenant = NEW.tenant AND attempt_id = parts[2]::uuid FOR SHARE;
      IF FOUND AND attempt_status = 'abandoned' THEN
        RAISE EXCEPTION 'Portable restore object cannot acquire a native reference' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END; $$`);
  if (await supportsTriggers(knex, 'external_files')) {
    await knex.raw('DROP TRIGGER IF EXISTS portable_restore_file_reference_fence ON external_files');
    await knex.raw('CREATE TRIGGER portable_restore_file_reference_fence BEFORE INSERT OR UPDATE OF tenant, storage_path ON external_files FOR EACH ROW EXECUTE FUNCTION portable_restore_file_reference_fence()');
  }
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained portable upload recovery records');
  if (await supportsTriggers(knex, 'external_files')) {
    await knex.raw('DROP TRIGGER IF EXISTS portable_restore_file_reference_fence ON external_files');
  }
  await knex.raw('DROP FUNCTION IF EXISTS portable_restore_file_reference_fence()');
  await knex.raw('DROP INDEX IF EXISTS portable_restore_file_path_idx');
  await knex.schema.dropTableIfExists(TABLE); await knex.raw('DROP FUNCTION IF EXISTS portable_restore_upload_transition()');
};
exports.config = { transaction: false };
