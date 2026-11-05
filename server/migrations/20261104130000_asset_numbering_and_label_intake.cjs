/**
 * Asset numbering primitives. Existing physical tags are never rewritten.
 * Legacy blanks and normalized duplicates are copied to an audit table. A
 * database trigger serializes new nonblank tag writes by tenant + normalized
 * tag and rejects collisions while allowing the legacy rows to remain.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('clients', (table) => {
    table.text('asset_prefix').nullable();
  });
  await knex.schema.alterTable('assets', (table) => {
    table.text('asset_tag_normalized').nullable();
  });

  await knex.schema.createTable('asset_tag_audit', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('audit_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('asset_id').notNullable();
    table.text('asset_tag').notNullable();
    table.text('normalized_tag');
    table.text('reason').notNullable();
    table.timestamp('discovered_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('resolved_at').nullable();
    table.text('resolution_note').nullable();
    table.primary(['tenant', 'audit_id']);
    table.index(['tenant', 'normalized_tag'], 'asset_tag_audit_tenant_norm_idx');
  });

  await knex.schema.createTable('asset_number_reservations', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('reservation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('client_id').nullable();
    table.text('asset_tag').notNullable();
    table.text('normalized_tag').notNullable();
    table.text('state').notNullable().defaultTo('reserved');
    table.timestamp('expires_at').notNullable();
    table.uuid('created_by').nullable();
    table.uuid('asset_id').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'reservation_id']);
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
    table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets');
    table.check("state IN ('reserved', 'committed', 'expired', 'released')", [], 'asset_number_reservations_state_ck');
    table.index(['tenant', 'normalized_tag'], 'asset_number_reservations_tag_idx');
    table.index(['tenant', 'state', 'expires_at'], 'asset_number_reservations_expiry_idx');
  });

  await knex.raw(`
    UPDATE assets
       SET asset_tag_normalized = NULLIF(translate(btrim(asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '')
  `);

  await knex.raw(`
    INSERT INTO asset_tag_audit (tenant, asset_id, asset_tag, normalized_tag, reason)
    SELECT tenant, asset_id, asset_tag, NULLIF(translate(btrim(asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), ''), 'blank'
      FROM assets
     WHERE btrim(asset_tag) = ''
  `);
  await knex.raw(`
    INSERT INTO asset_tag_audit (tenant, asset_id, asset_tag, normalized_tag, reason)
    SELECT a.tenant, a.asset_id, a.asset_tag, a.asset_tag_normalized, 'duplicate'
      FROM assets a
      JOIN (
        SELECT tenant, asset_tag_normalized
          FROM assets
         WHERE asset_tag_normalized IS NOT NULL
         GROUP BY tenant, asset_tag_normalized
        HAVING count(*) > 1
      ) d ON d.tenant = a.tenant AND d.asset_tag_normalized = a.asset_tag_normalized
  `);

  await knex.raw(`
    CREATE INDEX assets_tenant_asset_tag_normalized_idx
        ON assets (tenant, asset_tag_normalized)
     WHERE asset_tag_normalized IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX clients_tenant_asset_prefix_uq
        ON clients (tenant, asset_prefix)
     WHERE asset_prefix IS NOT NULL AND asset_prefix <> ''
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.normalize_client_asset_prefix()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.asset_prefix IS NULL OR btrim(NEW.asset_prefix) = '' THEN
        NEW.asset_prefix := NULL;
      ELSE
        NEW.asset_prefix := upper(btrim(NEW.asset_prefix));
        IF length(NEW.asset_prefix) > 10 OR NEW.asset_prefix !~ '^[A-Z0-9-]+$' THEN
          RAISE EXCEPTION 'Asset prefix must be at most 10 uppercase letters, digits, or hyphens'
            USING ERRCODE = '23514', CONSTRAINT = 'clients_asset_prefix_format_ck';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER clients_normalize_asset_prefix
      BEFORE INSERT OR UPDATE OF asset_prefix ON clients
      FOR EACH ROW EXECUTE FUNCTION public.normalize_client_asset_prefix();

    CREATE OR REPLACE FUNCTION public.guard_normalized_asset_tag()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE collision_id uuid;
    BEGIN
      NEW.asset_tag_normalized := NULLIF(translate(btrim(NEW.asset_tag), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '');
      IF NEW.asset_tag_normalized IS NULL THEN RETURN NEW; END IF;

      -- Tags belonging to one tenant route to one Citus shard. Locking the
      -- normalized key makes the check safe against concurrent insert/edit.
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant::text || ':' || NEW.asset_tag_normalized, 0));
      SELECT asset_id INTO collision_id
        FROM assets
       WHERE tenant = NEW.tenant
         AND asset_tag_normalized = NEW.asset_tag_normalized
         AND asset_id IS DISTINCT FROM NEW.asset_id
       LIMIT 1;
      IF collision_id IS NOT NULL THEN
        RAISE EXCEPTION 'Asset tag already exists in this tenant (asset %)', collision_id
          USING ERRCODE = '23505', CONSTRAINT = 'assets_tenant_asset_tag_normalized_uq';
      END IF;
      IF EXISTS (
        SELECT 1 FROM asset_number_reservations
         WHERE tenant = NEW.tenant
           AND normalized_tag = NEW.asset_tag_normalized
           AND state IN ('reserved', 'expired', 'released')
      ) THEN
        RAISE EXCEPTION 'Asset tag is held by a printed or released reservation'
          USING ERRCODE = '23505', CONSTRAINT = 'asset_number_reservations_normalized_tag_uq';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER assets_guard_normalized_tag
      BEFORE INSERT OR UPDATE OF asset_tag, asset_tag_normalized ON assets
      FOR EACH ROW EXECUTE FUNCTION public.guard_normalized_asset_tag();
  `);

  await knex.raw(`ALTER TABLE asset_tag_audit ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`CREATE POLICY tenant_isolation_policy ON asset_tag_audit USING (tenant::text = current_setting('app.current_tenant')::text)`);
  await knex.raw(`CREATE POLICY tenant_isolation_insert_policy ON asset_tag_audit FOR INSERT WITH CHECK (tenant::text = current_setting('app.current_tenant')::text)`);
  await knex.raw(`ALTER TABLE asset_number_reservations ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`CREATE POLICY tenant_isolation_policy ON asset_number_reservations USING (tenant::text = current_setting('app.current_tenant')::text)`);
  await knex.raw(`CREATE POLICY tenant_isolation_insert_policy ON asset_number_reservations FOR INSERT WITH CHECK (tenant::text = current_setting('app.current_tenant')::text)`);

  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  if (citus.rows[0]?.enabled) {
    await knex.raw("SELECT create_distributed_table('asset_tag_audit', 'tenant', colocate_with => 'assets')");
    await knex.raw("SELECT create_distributed_table('asset_number_reservations', 'tenant', colocate_with => 'assets')");
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS assets_guard_normalized_tag ON assets');
  await knex.raw('DROP TRIGGER IF EXISTS clients_normalize_asset_prefix ON clients');
  await knex.raw('DROP FUNCTION IF EXISTS public.guard_normalized_asset_tag()');
  await knex.raw('DROP FUNCTION IF EXISTS public.normalize_client_asset_prefix()');
  await knex.schema.dropTableIfExists('asset_number_reservations');
  await knex.schema.dropTableIfExists('asset_tag_audit');
  await knex.raw('DROP INDEX IF EXISTS assets_tenant_asset_tag_normalized_idx');
  await knex.raw('DROP INDEX IF EXISTS clients_tenant_asset_prefix_uq');
  await knex.schema.alterTable('assets', (table) => table.dropColumn('asset_tag_normalized'));
  await knex.schema.alterTable('clients', (table) => table.dropColumn('asset_prefix'));
};

exports.config = { transaction: false };
