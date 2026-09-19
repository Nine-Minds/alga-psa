/**
 * Migration: Create Normalized Software Inventory Tables
 *
 * Replaces the JSONB installed_software columns with normalized tables for:
 * - Better querying ("find all assets with Chrome installed")
 * - Deduplication (same software across assets shares one catalog entry)
 * - Change tracking (detect installs/uninstalls between syncs)
 * - Category support (Browser, Security, Productivity, etc.)
 * - Future features (license tracking, vulnerability matching)
 *
 * Tables created:
 * - software_catalog: Canonical list of software per tenant
 * - asset_software: Junction table linking assets to installed software
 *
 * Also creates:
 * - v_asset_software_details: Helper view for easy querying
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // ============================================================================
    // SOFTWARE CATALOG: Canonical list of software (deduplicated per tenant)
    // ============================================================================
    await knex.schema.createTable('software_catalog', table => {
        table.uuid('software_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');

        // Identification
        table.string('name', 500).notNullable(); // Software name (e.g., "Google Chrome")
        table.string('publisher', 255).nullable(); // Publisher (e.g., "Google LLC")
        table.string('normalized_name', 500).notNullable(); // Lowercase, trimmed for matching

        // Classification
        table.string('category', 100).nullable(); // e.g., "Browser", "Productivity", "Security", "Development"
        table.string('software_type', 50).notNullable().defaultTo('application'); // 'application', 'driver', 'update', 'system'

        // Management flags
        table.boolean('is_managed').notNullable().defaultTo(false); // Tracked for patching/licensing
        table.boolean('is_security_relevant').notNullable().defaultTo(false); // Antivirus, firewall, etc.

        // Metadata
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        // Primary key
        table.primary(['tenant', 'software_id']);

        // Ensure unique software per tenant (by normalized name + publisher)
        // Using COALESCE to handle null publisher in unique constraint
        table.unique(['tenant', 'normalized_name', 'publisher'], {
            indexName: 'idx_software_catalog_unique_name_publisher'
        });
    });

    // Indexes for software_catalog
    await knex.schema.alterTable('software_catalog', table => {
        table.index(['tenant'], 'idx_software_catalog_tenant');
        table.index(['tenant', 'normalized_name'], 'idx_software_catalog_name');
        table.index(['tenant', 'publisher'], 'idx_software_catalog_publisher');
        table.index(['tenant', 'category'], 'idx_software_catalog_category');
        table.index(['tenant', 'is_managed'], 'idx_software_catalog_managed');
        table.index(['tenant', 'is_security_relevant'], 'idx_software_catalog_security');
    });

    // ============================================================================
    // ASSET SOFTWARE: Junction table linking assets to installed software
    // ============================================================================
    await knex.schema.createTable('asset_software', table => {
        table.uuid('tenant').notNullable();
        table.uuid('asset_id').notNullable();
        table.uuid('software_id').notNullable();

        // Installation details
        table.string('version', 100).nullable(); // Installed version
        table.date('install_date').nullable(); // When it was installed (from RMM)
        table.text('install_path').nullable(); // Installation location
        table.bigInteger('size_bytes').nullable(); // Size on disk

        // Sync tracking
        table.timestamp('first_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()); // When we first detected it
        table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()); // Updated each sync

        // Status
        table.boolean('is_current').notNullable().defaultTo(true); // FALSE = was uninstalled (soft delete)
        table.timestamp('uninstalled_at', { useTz: true }).nullable(); // When we detected removal

        // Composite primary key
        table.primary(['tenant', 'asset_id', 'software_id']);

        // Foreign key to assets
        table.foreign(['tenant', 'asset_id'])
            .references(['tenant', 'asset_id'])
            .inTable('assets')
            .onDelete('CASCADE');

        // Foreign key to software_catalog
        table.foreign(['tenant', 'software_id'])
            .references(['tenant', 'software_id'])
            .inTable('software_catalog')
            .onDelete('CASCADE');
    });

    // Indexes for asset_software - optimized for common query patterns
    await knex.schema.alterTable('asset_software', table => {
        // 1. "Show all software on asset X" (asset detail page)
        table.index(['tenant', 'asset_id', 'is_current'], 'idx_asset_software_asset_current');

        // 2. "Find all assets with software Y installed" (fleet search)
        table.index(['tenant', 'software_id', 'is_current'], 'idx_asset_software_software_current');

        // 3. "Show recently installed software" (audit/reporting)
        table.index(['tenant', 'first_seen_at'], 'idx_asset_software_first_seen');

        // 4. "Show recently uninstalled software" (change tracking)
        table.index(['tenant', 'uninstalled_at'], 'idx_asset_software_uninstalled');

        // 5. "Find software by version" (vulnerability/compliance)
        table.index(['tenant', 'software_id', 'version'], 'idx_asset_software_version');
    });

    // ============================================================================
    // HELPER VIEW: Denormalized view for easy querying
    // ============================================================================
    await knex.raw(`
        CREATE VIEW v_asset_software_details AS
        SELECT
            asw.tenant,
            asw.asset_id,
            a.name AS asset_name,
            a.asset_type,
            a.client_id,
            c.client_name,
            sc.software_id,
            sc.name AS software_name,
            sc.publisher,
            sc.normalized_name,
            sc.category,
            sc.software_type,
            sc.is_managed,
            sc.is_security_relevant,
            asw.version,
            asw.install_date,
            asw.install_path,
            asw.size_bytes,
            asw.first_seen_at,
            asw.last_seen_at,
            asw.is_current,
            asw.uninstalled_at
        FROM asset_software asw
        JOIN software_catalog sc ON sc.tenant = asw.tenant AND sc.software_id = asw.software_id
        JOIN assets a ON a.tenant = asw.tenant AND a.asset_id = asw.asset_id
        LEFT JOIN clients c ON c.tenant = a.tenant AND c.client_id = a.client_id;
    `);

    // ============================================================================
    // TRIGGERS: Updated timestamp
    // ============================================================================
    await knex.raw(`
        CREATE TRIGGER set_timestamp_software_catalog
        BEFORE UPDATE ON software_catalog
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop trigger
    await knex.raw(`
        DROP TRIGGER IF EXISTS set_timestamp_software_catalog ON software_catalog;
    `);

    // Drop view
    await knex.raw(`
        DROP VIEW IF EXISTS v_asset_software_details;
    `);

    // Drop tables in reverse order (junction table first due to FK constraints)
    await knex.schema.dropTableIfExists('asset_software');
    await knex.schema.dropTableIfExists('software_catalog');
};
