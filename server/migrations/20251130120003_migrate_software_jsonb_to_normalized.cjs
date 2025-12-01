/**
 * Migration: Migrate Software JSONB to Normalized Tables
 *
 * Populates the new software_catalog and asset_software tables from existing
 * installed_software JSONB columns in workstation_assets and server_assets.
 *
 * This migration:
 * 1. Reads all existing JSONB software data
 * 2. Creates deduplicated entries in software_catalog
 * 3. Creates junction entries in asset_software
 * 4. Does NOT drop the original JSONB columns (for rollback safety)
 *
 * The JSONB columns can be dropped in a future migration after validation.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Helper function to normalize software name for matching
    const normalizeName = (name) => {
        if (!name) return '';
        return name.toLowerCase().trim();
    };

    // Helper function to infer software category from name
    const inferCategory = (name) => {
        if (!name) return null;
        const lower = name.toLowerCase();
        if (/chrome|firefox|safari|edge|opera|brave|browser/.test(lower)) return 'Browser';
        if (/office|word|excel|powerpoint|outlook|teams|onenote/.test(lower)) return 'Productivity';
        if (/visual studio|vscode|intellij|xcode|android studio|eclipse|jetbrains|rider|webstorm|phpstorm|pycharm/.test(lower)) return 'Development';
        if (/antivirus|defender|norton|mcafee|sentinelone|crowdstrike|sophos|bitdefender|kaspersky|malwarebytes|firewall|security/.test(lower)) return 'Security';
        if (/zoom|teams|slack|discord|skype|webex/.test(lower)) return 'Communication';
        if (/adobe|photoshop|illustrator|acrobat|premiere|lightroom|indesign|creative/.test(lower)) return 'Creative';
        if (/node|python|java|dotnet|\.net|runtime|framework|sdk|jdk|jre/.test(lower)) return 'Runtime';
        if (/driver|nvidia|amd|intel|realtek/.test(lower)) return 'Driver';
        return null;
    };

    // Helper function to determine software type
    const inferSoftwareType = (name) => {
        if (!name) return 'application';
        const lower = name.toLowerCase();
        if (/driver/.test(lower)) return 'driver';
        if (/update|hotfix|kb\d+|patch/.test(lower)) return 'update';
        if (/runtime|framework|redistributable/.test(lower)) return 'system';
        return 'application';
    };

    // Cache for software catalog entries to avoid duplicate lookups
    const softwareCatalogCache = new Map(); // key: 'tenant|normalized_name|publisher' -> software_id

    // Process workstation_assets
    const workstations = await knex('workstation_assets')
        .select('tenant', 'asset_id', 'installed_software')
        .whereNotNull('installed_software');

    console.log(`Processing ${workstations.length} workstations with software data...`);

    for (const ws of workstations) {
        if (!ws.installed_software) continue;

        let softwareList;
        try {
            softwareList = typeof ws.installed_software === 'string'
                ? JSON.parse(ws.installed_software)
                : ws.installed_software;
        } catch (e) {
            console.warn(`Failed to parse software for workstation ${ws.asset_id}:`, e.message);
            continue;
        }

        if (!Array.isArray(softwareList) || softwareList.length === 0) continue;

        for (const sw of softwareList) {
            if (!sw.name) continue;

            const normalizedName = normalizeName(sw.name);
            const publisher = sw.publisher?.trim() || null;
            const cacheKey = `${ws.tenant}|${normalizedName}|${publisher || ''}`;

            let softwareId = softwareCatalogCache.get(cacheKey);

            // Create software catalog entry if it doesn't exist
            if (!softwareId) {
                // Check if it exists in DB
                const existing = await knex('software_catalog')
                    .where({
                        tenant: ws.tenant,
                        normalized_name: normalizedName,
                        publisher: publisher
                    })
                    .first();

                if (existing) {
                    softwareId = existing.software_id;
                } else {
                    // Create new entry
                    const [entry] = await knex('software_catalog')
                        .insert({
                            tenant: ws.tenant,
                            name: sw.name.trim(),
                            normalized_name: normalizedName,
                            publisher: publisher,
                            category: inferCategory(sw.name),
                            software_type: inferSoftwareType(sw.name),
                            is_managed: false,
                            is_security_relevant: /antivirus|security|defender|firewall/.test(sw.name.toLowerCase())
                        })
                        .returning('software_id');

                    softwareId = entry.software_id;
                }

                softwareCatalogCache.set(cacheKey, softwareId);
            }

            // Create asset_software entry
            try {
                await knex('asset_software')
                    .insert({
                        tenant: ws.tenant,
                        asset_id: ws.asset_id,
                        software_id: softwareId,
                        version: sw.version || null,
                        install_date: sw.installDate ? new Date(sw.installDate) : null,
                        install_path: sw.location || null,
                        size_bytes: sw.size || null,
                        first_seen_at: knex.fn.now(),
                        last_seen_at: knex.fn.now(),
                        is_current: true
                    })
                    .onConflict(['tenant', 'asset_id', 'software_id'])
                    .ignore(); // Ignore duplicates
            } catch (e) {
                // Ignore duplicate key errors
                if (!e.message.includes('duplicate key')) {
                    console.warn(`Failed to insert software ${sw.name} for asset ${ws.asset_id}:`, e.message);
                }
            }
        }
    }

    // Process server_assets
    const servers = await knex('server_assets')
        .select('tenant', 'asset_id', 'installed_software')
        .whereNotNull('installed_software');

    console.log(`Processing ${servers.length} servers with software data...`);

    for (const srv of servers) {
        if (!srv.installed_software) continue;

        let softwareList;
        try {
            softwareList = typeof srv.installed_software === 'string'
                ? JSON.parse(srv.installed_software)
                : srv.installed_software;
        } catch (e) {
            console.warn(`Failed to parse software for server ${srv.asset_id}:`, e.message);
            continue;
        }

        if (!Array.isArray(softwareList) || softwareList.length === 0) continue;

        for (const sw of softwareList) {
            if (!sw.name) continue;

            const normalizedName = normalizeName(sw.name);
            const publisher = sw.publisher?.trim() || null;
            const cacheKey = `${srv.tenant}|${normalizedName}|${publisher || ''}`;

            let softwareId = softwareCatalogCache.get(cacheKey);

            if (!softwareId) {
                const existing = await knex('software_catalog')
                    .where({
                        tenant: srv.tenant,
                        normalized_name: normalizedName,
                        publisher: publisher
                    })
                    .first();

                if (existing) {
                    softwareId = existing.software_id;
                } else {
                    const [entry] = await knex('software_catalog')
                        .insert({
                            tenant: srv.tenant,
                            name: sw.name.trim(),
                            normalized_name: normalizedName,
                            publisher: publisher,
                            category: inferCategory(sw.name),
                            software_type: inferSoftwareType(sw.name),
                            is_managed: false,
                            is_security_relevant: /antivirus|security|defender|firewall/.test(sw.name.toLowerCase())
                        })
                        .returning('software_id');

                    softwareId = entry.software_id;
                }

                softwareCatalogCache.set(cacheKey, softwareId);
            }

            try {
                await knex('asset_software')
                    .insert({
                        tenant: srv.tenant,
                        asset_id: srv.asset_id,
                        software_id: softwareId,
                        version: sw.version || null,
                        install_date: sw.installDate ? new Date(sw.installDate) : null,
                        install_path: sw.location || null,
                        size_bytes: sw.size || null,
                        first_seen_at: knex.fn.now(),
                        last_seen_at: knex.fn.now(),
                        is_current: true
                    })
                    .onConflict(['tenant', 'asset_id', 'software_id'])
                    .ignore();
            } catch (e) {
                if (!e.message.includes('duplicate key')) {
                    console.warn(`Failed to insert software ${sw.name} for asset ${srv.asset_id}:`, e.message);
                }
            }
        }
    }

    const catalogCount = await knex('software_catalog').count('* as count').first();
    const assetSoftwareCount = await knex('asset_software').count('* as count').first();

    console.log(`Migration complete. Created ${catalogCount.count} software catalog entries and ${assetSoftwareCount.count} asset-software relationships.`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Clear the migrated data (the JSONB columns are still intact)
    await knex('asset_software').del();
    await knex('software_catalog').del();

    console.log('Cleared migrated software data from normalized tables.');
};
