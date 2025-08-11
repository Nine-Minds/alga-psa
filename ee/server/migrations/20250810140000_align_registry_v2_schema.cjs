/** EE-only migration: align Registry v2 schema with spec
 *
 * This migration aligns existing EE tables to the Registry v2 spec:
 * 1) extension_registry
 * 2) extension_version
 * 3) extension_bundle
 * 4) tenant_extension_install
 * 5) extension_execution_log
 * 6) extension_quota_usage
 *
 * Notes:
 * - Uses Postgres-specific features (jsonb, check constraints).
 * - Non-destructive for main registry tables where possible.
 * - For execution_log and quota_usage, we preserve old tables by renaming to *_old and create new spec-compliant tables.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  // 1) extension_registry
  const hasExtReg = await knex.schema.hasTable('extension_registry');
  if (hasExtReg) {
    // Ensure an index for (publisher, name)
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS extension_registry_publisher_name_idx ON extension_registry (publisher, name)`
    );
    // Prefer DB default UUID if gen_random_uuid is available
    await knex.raw(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'gen_random_uuid' AND n.nspname IN ('pgcrypto','public')
        ) THEN
          EXECUTE 'ALTER TABLE extension_registry ALTER COLUMN id SET DEFAULT gen_random_uuid()';
        END IF;
      END
      $$;
    `);
    // Ensure timestamps have defaults if columns exist
    await knex.raw(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'extension_registry' AND column_name = 'created_at'
        ) THEN
          EXECUTE 'ALTER TABLE extension_registry ALTER COLUMN created_at SET DEFAULT now()';
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'extension_registry' AND column_name = 'updated_at'
        ) THEN
          EXECUTE 'ALTER TABLE extension_registry ALTER COLUMN updated_at SET DEFAULT now()';
        END IF;
      END
      $$;
    `);
  }

  // 2) extension_version
  const hasExtVer = await knex.schema.hasTable('extension_version');
  if (hasExtVer) {
    const hasApiEndpoints = await knex.schema.hasColumn('extension_version', 'api_endpoints');
    if (!hasApiEndpoints) {
      await knex.schema.alterTable('extension_version', (t) => {
        // api_endpoints is always a JSON array; default to []
        t.jsonb('api_endpoints').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      });
      // Backfill api_endpoints from existing "api" column if present
      const hasApi = await knex.schema.hasColumn('extension_version', 'api');
      if (hasApi) {
        // If "api" is an array of endpoints, copy directly.
        // If "api" is an object and its "endpoints" is an array, copy that; otherwise []
        await knex.raw(`
          UPDATE extension_version
          SET api_endpoints = CASE
            WHEN jsonb_typeof(api) = 'array' THEN api
            WHEN jsonb_typeof(api) = 'object' AND jsonb_typeof(api->'endpoints') = 'array' THEN api->'endpoints'
            ELSE '[]'::jsonb
          END
        `);
      } else {
        await knex.raw(`UPDATE extension_version SET api_endpoints = '[]'::jsonb`);
      }
    }
    // Ensure capabilities is jsonb default '[]' if column exists
    await knex.raw(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'extension_version' AND column_name = 'capabilities'
        ) THEN
          EXECUTE 'ALTER TABLE extension_version ALTER COLUMN capabilities SET DEFAULT ''[]''::jsonb';
        END IF;
      END
      $$;
    `);
    // Index for (registry_id, version)
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS extension_version_registry_version_idx ON extension_version (registry_id, version)`
    );
  }

  // 3) extension_bundle
  const hasBundle = await knex.schema.hasTable('extension_bundle');
  if (hasBundle) {
    // Add missing columns and indexes
    const hasStorageUrl = await knex.schema.hasColumn('extension_bundle', 'storage_url');
    if (!hasStorageUrl) {
      await knex.schema.alterTable('extension_bundle', (t) => {
        t.text('storage_url').defaultTo(null);
      });
    }
    const hasSizeBytes = await knex.schema.hasColumn('extension_bundle', 'size_bytes');
    if (!hasSizeBytes) {
      await knex.schema.alterTable('extension_bundle', (t) => {
        t.bigInteger('size_bytes').defaultTo(null);
      });
    }
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS extension_bundle_content_hash_idx ON extension_bundle (content_hash)`
    );
  }

  // 4) tenant_extension_install
  const hasInstall = await knex.schema.hasTable('tenant_extension_install');
  if (hasInstall) {
    // Rename columns to align with spec if they exist
    const hasEnabled = await knex.schema.hasColumn('tenant_extension_install', 'enabled');
    if (hasEnabled) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.renameColumn('enabled', 'is_enabled');
      });
    }
    const hasInstalledAt = await knex.schema.hasColumn('tenant_extension_install', 'installed_at');
    if (hasInstalledAt) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.renameColumn('installed_at', 'created_at');
      });
    }
    // Ensure columns exist per spec
    const hasUpdatedAt = await knex.schema.hasColumn('tenant_extension_install', 'updated_at');
    if (!hasUpdatedAt) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      });
    }
    const hasStatus = await knex.schema.hasColumn('tenant_extension_install', 'status');
    if (!hasStatus) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.text('status').notNullable().defaultTo('enabled');
      });
      // Add check constraint for status (enabled|disabled|pending) only if missing
      await knex.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'tenant_extension_install_status_chk'
          ) THEN
            EXECUTE 'ALTER TABLE tenant_extension_install ADD CONSTRAINT tenant_extension_install_status_chk CHECK (status IN (''enabled'',''disabled'',''pending''))';
          END IF;
        END
        $$;
      `);
    }
    // Ensure is_enabled exists and is boolean not null default true
    const hasIsEnabled = await knex.schema.hasColumn('tenant_extension_install', 'is_enabled');
    if (!hasIsEnabled) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.boolean('is_enabled').notNullable().defaultTo(true);
      });
    }
    // Ensure index for (tenant_id, registry_id)
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS tenant_extension_install_tenant_registry_idx ON tenant_extension_install (tenant_id, registry_id)`
    );
  }

  // 5) extension_execution_log (recreate to match spec; preserve old as *_old)
  const hasExecLog = await knex.schema.hasTable('extension_execution_log');
  if (hasExecLog) {
    // If schema differs, preserve old data by renaming table and create new
    await knex.schema.renameTable('extension_execution_log', 'extension_execution_log_old');
    // Ensure old PK constraint/index does not conflict with new table
    try {
      await knex.raw(
        `ALTER TABLE extension_execution_log_old RENAME CONSTRAINT extension_execution_log_pkey TO extension_execution_log_old_pkey`
      );
    } catch (_e) {
      // ignore if constraint already renamed or not present
    }
  }
  // If a previous attempt already renamed to *_old, ensure its PK name won't collide
  const hasExecLogOld = await knex.schema.hasTable('extension_execution_log_old');
  if (hasExecLogOld) {
    try {
      await knex.raw(
        `ALTER TABLE extension_execution_log_old RENAME CONSTRAINT extension_execution_log_pkey TO extension_execution_log_old_pkey`
      );
    } catch (_e) {}
  }
  await knex.schema.createTable('extension_execution_log', (t) => {
    t.uuid('id').primary();
    t.string('tenant_id').notNullable();
    t.uuid('registry_id').notNullable();
    t.uuid('version_id').notNullable();
    t.string('request_id');
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at');
    t.text('status').notNullable(); // ok|error|timeout|oom|policy_denied
    t.jsonb('metrics').defaultTo(null);
    t.text('error').defaultTo(null);
    t.index(['tenant_id', 'registry_id', 'started_at'], 'extension_execution_log_tenant_registry_started_idx');
  });

  // 6) extension_quota_usage (recreate to match spec; preserve old as *_old)
  const hasQuota = await knex.schema.hasTable('extension_quota_usage');
  if (hasQuota) {
    await knex.schema.renameTable('extension_quota_usage', 'extension_quota_usage_old');
    // Ensure old PK constraint/index does not conflict with new table
    try {
      await knex.raw(
        `ALTER TABLE extension_quota_usage_old RENAME CONSTRAINT extension_quota_usage_pkey TO extension_quota_usage_old_pkey`
      );
    } catch (_e) {
      // ignore if constraint already renamed or not present
    }
  }
  // If a previous attempt already renamed to *_old, ensure its PK name won't collide
  const hasQuotaOld = await knex.schema.hasTable('extension_quota_usage_old');
  if (hasQuotaOld) {
    try {
      await knex.raw(
        `ALTER TABLE extension_quota_usage_old RENAME CONSTRAINT extension_quota_usage_pkey TO extension_quota_usage_old_pkey`
      );
    } catch (_e) {}
  }
  await knex.schema.createTable('extension_quota_usage', (t) => {
    t.string('tenant_id').notNullable();
    t.uuid('registry_id').notNullable();
    t.timestamp('window_start').notNullable();
    t.bigInteger('cpu_ms').notNullable().defaultTo(0);
    t.bigInteger('mem_mb_ms').notNullable().defaultTo(0);
    t.bigInteger('invocations').notNullable().defaultTo(0);
    t.bigInteger('egress_bytes').notNullable().defaultTo(0);
    t.primary(['tenant_id', 'registry_id', 'window_start']);
    t.index(['tenant_id', 'window_start'], 'extension_quota_usage_tenant_window_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // Drop new quota_usage and restore old if present
  const hasQuotaNew = await knex.schema.hasTable('extension_quota_usage');
  if (hasQuotaNew) {
    await knex.schema.dropTable('extension_quota_usage');
  }
  const hasQuotaOld = await knex.schema.hasTable('extension_quota_usage_old');
  if (hasQuotaOld) {
    await knex.schema.renameTable('extension_quota_usage_old', 'extension_quota_usage');
  }

  // Drop new execution_log and restore old if present
  const hasExecNew = await knex.schema.hasTable('extension_execution_log');
  if (hasExecNew) {
    await knex.schema.dropTable('extension_execution_log');
  }
  const hasExecOld = await knex.schema.hasTable('extension_execution_log_old');
  if (hasExecOld) {
    await knex.schema.renameTable('extension_execution_log_old', 'extension_execution_log');
  }

  // Reverse some additive changes (best-effort)
  // tenant_extension_install
  const hasInstall = await knex.schema.hasTable('tenant_extension_install');
  if (hasInstall) {
    // Drop check constraint
    try {
      await knex.raw(`ALTER TABLE tenant_extension_install DROP CONSTRAINT tenant_extension_install_status_chk`);
    } catch (_e) {}
    // Remove status / updated_at if they exist
    const hasStatus = await knex.schema.hasColumn('tenant_extension_install', 'status');
    if (hasStatus) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.dropColumn('status');
      });
    }
    const hasUpdatedAt = await knex.schema.hasColumn('tenant_extension_install', 'updated_at');
    if (hasUpdatedAt) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.dropColumn('updated_at');
      });
    }
    // Rename columns back if they previously existed
    const hasIsEnabled = await knex.schema.hasColumn('tenant_extension_install', 'is_enabled');
    if (hasIsEnabled) {
      // add back enabled, then copy & drop
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.boolean('enabled').defaultTo(true);
      });
      try {
        await knex.raw(`UPDATE tenant_extension_install SET enabled = COALESCE(is_enabled, true)`);
      } catch (_e) {}
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.dropColumn('is_enabled');
      });
    }
    const hasCreatedAt = await knex.schema.hasColumn('tenant_extension_install', 'created_at');
    const hadInstalledAt = !(await knex.schema.hasColumn('tenant_extension_install', 'installed_at')); // we want installed_at restored only if missing
    if (hasCreatedAt && hadInstalledAt) {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.timestamp('installed_at').defaultTo(knex.fn.now());
      });
      try {
        await knex.raw(`UPDATE tenant_extension_install SET installed_at = created_at`);
      } catch (_e) {}
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.dropColumn('created_at');
      });
    }
    // Drop added index
    try {
      await knex.schema.alterTable('tenant_extension_install', (t) => {
        t.dropIndex(['tenant_id', 'registry_id'], 'tenant_extension_install_tenant_registry_idx');
      });
    } catch (_e) {}
  }

  // extension_bundle: drop added columns and index
  const hasBundle = await knex.schema.hasTable('extension_bundle');
  if (hasBundle) {
    try {
      await knex.schema.alterTable('extension_bundle', (t) => {
        t.dropIndex(['content_hash'], 'extension_bundle_content_hash_idx');
      });
    } catch (_e) {}
    const hasStorageUrl = await knex.schema.hasColumn('extension_bundle', 'storage_url');
    if (hasStorageUrl) {
      await knex.schema.alterTable('extension_bundle', (t) => {
        t.dropColumn('storage_url');
      });
    }
    const hasSizeBytes = await knex.schema.hasColumn('extension_bundle', 'size_bytes');
    if (hasSizeBytes) {
      await knex.schema.alterTable('extension_bundle', (t) => {
        t.dropColumn('size_bytes');
      });
    }
  }

  // extension_version: drop api_endpoints index/column if added
  const hasExtVer = await knex.schema.hasTable('extension_version');
  if (hasExtVer) {
    const hasApiEndpoints = await knex.schema.hasColumn('extension_version', 'api_endpoints');
    if (hasApiEndpoints) {
      await knex.schema.alterTable('extension_version', (t) => {
        t.dropColumn('api_endpoints');
      });
    }
    try {
      await knex.schema.alterTable('extension_version', (t) => {
        t.dropIndex(['registry_id', 'version'], 'extension_version_registry_version_idx');
      });
    } catch (_e) {}
  }

  // extension_registry: drop index; cannot reliably unset default
  const hasExtReg = await knex.schema.hasTable('extension_registry');
  if (hasExtReg) {
    try {
      await knex.schema.alterTable('extension_registry', (t) => {
        t.dropIndex(['publisher', 'name'], 'extension_registry_publisher_name_idx');
      });
    } catch (_e) {}
  }
};
