/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create extension tables
    await knex.schema
        // Workstation Assets
        .createTable('workstation_assets', table => {
            table.uuid('tenant').notNullable();
            table.uuid('asset_id').notNullable();
            table.string('os_type');
            table.string('os_version');
            table.string('cpu_model');
            table.integer('cpu_cores');
            table.integer('ram_gb');
            table.string('storage_type');
            table.integer('storage_capacity_gb');
            table.string('gpu_model');
            table.timestamp('last_login');
            table.jsonb('installed_software').defaultTo('[]');
            table.primary(['tenant', 'asset_id']);
            table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
            table.index(['tenant', 'os_type']);
            table.index(['tenant', 'last_login']);
        })
        // Network Device Assets
        .createTable('network_device_assets', table => {
            table.uuid('tenant').notNullable();
            table.uuid('asset_id').notNullable();
            table.enum('device_type', ['switch', 'router', 'firewall', 'access_point', 'load_balancer']).notNullable();
            table.string('management_ip');
            table.integer('port_count');
            table.string('firmware_version');
            table.boolean('supports_poe').defaultTo(false);
            table.decimal('power_draw_watts', 8, 2);
            table.jsonb('vlan_config').defaultTo('{}');
            table.jsonb('port_config').defaultTo('{}');
            table.primary(['tenant', 'asset_id']);
            table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
            table.index(['tenant', 'device_type']);
            table.index(['tenant', 'management_ip']);
        })
        // Server Assets
        .createTable('server_assets', table => {
            table.uuid('tenant').notNullable();
            table.uuid('asset_id').notNullable();
            table.string('os_type');
            table.string('os_version');
            table.string('cpu_model');
            table.integer('cpu_cores');
            table.integer('ram_gb');
            table.jsonb('storage_config').defaultTo('[]');
            table.string('raid_config');
            table.boolean('is_virtual').defaultTo(false);
            table.string('hypervisor');
            table.jsonb('network_interfaces').defaultTo('[]');
            table.string('primary_ip');
            table.jsonb('installed_services').defaultTo('[]');
            table.primary(['tenant', 'asset_id']);
            table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
            table.index(['tenant', 'os_type']);
            table.index(['tenant', 'is_virtual']);
            table.index(['tenant', 'primary_ip']);
        })
        // Mobile Device Assets
        .createTable('mobile_device_assets', table => {
            table.uuid('tenant').notNullable();
            table.uuid('asset_id').notNullable();
            table.string('os_type');
            table.string('os_version');
            table.string('model');
            table.string('imei');
            table.string('phone_number');
            table.string('carrier');
            table.timestamp('last_check_in');
            table.boolean('is_supervised').defaultTo(false);
            table.jsonb('installed_apps').defaultTo('[]');
            table.primary(['tenant', 'asset_id']);
            table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
            table.index(['tenant', 'os_type']);
            table.index(['tenant', 'last_check_in']);
            table.index(['tenant', 'imei']);
        })
        // Printer Assets
        .createTable('printer_assets', table => {
            table.uuid('tenant').notNullable();
            table.uuid('asset_id').notNullable();
            table.string('model');
            table.string('ip_address');
            table.boolean('is_network_printer').defaultTo(true);
            table.boolean('supports_color').defaultTo(false);
            table.boolean('supports_duplex').defaultTo(false);
            table.integer('max_paper_size');
            table.jsonb('supported_paper_types').defaultTo('[]');
            table.integer('monthly_duty_cycle');
            table.jsonb('supply_levels').defaultTo('{}');
            table.primary(['tenant', 'asset_id']);
            table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
            table.index(['tenant', 'ip_address']);
            table.index(['tenant', 'is_network_printer']);
        });

    // Add RLS policies
    await knex.raw(`
        ALTER TABLE workstation_assets ENABLE ROW LEVEL SECURITY;
        ALTER TABLE network_device_assets ENABLE ROW LEVEL SECURITY;
        ALTER TABLE server_assets ENABLE ROW LEVEL SECURITY;
        ALTER TABLE mobile_device_assets ENABLE ROW LEVEL SECURITY;
        ALTER TABLE printer_assets ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY tenant_isolation_policy ON workstation_assets
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
        
        CREATE POLICY tenant_isolation_policy ON network_device_assets
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
        
        CREATE POLICY tenant_isolation_policy ON server_assets
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
        
        CREATE POLICY tenant_isolation_policy ON mobile_device_assets
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
        
        CREATE POLICY tenant_isolation_policy ON printer_assets
            USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
    `);

    // Migrate existing data from JSON attributes
    await knex.raw(`
        -- Migrate Workstation Assets
        INSERT INTO workstation_assets (tenant, asset_id, os_type, os_version, cpu_model, cpu_cores, ram_gb, storage_type, storage_capacity_gb, gpu_model, installed_software)
        SELECT 
            tenant,
            asset_id,
            attributes->>'os_type',
            attributes->>'os_version',
            attributes->>'cpu_model',
            (attributes->>'cpu_cores')::integer,
            (attributes->>'ram_gb')::integer,
            attributes->>'storage_type',
            (attributes->>'storage_capacity_gb')::integer,
            attributes->>'gpu_model',
            COALESCE(attributes->'installed_software', '[]'::jsonb)
        FROM assets
        WHERE attributes->>'asset_type' = 'workstation';

        -- Migrate Network Device Assets
        INSERT INTO network_device_assets (tenant, asset_id, device_type, management_ip, port_count, firmware_version, supports_poe, vlan_config, port_config)
        SELECT 
            tenant,
            asset_id,
            COALESCE(attributes->>'device_type', 'switch'),
            attributes->>'management_ip',
            (attributes->>'port_count')::integer,
            attributes->>'firmware_version',
            (attributes->>'supports_poe')::boolean,
            COALESCE(attributes->'vlan_config', '{}'::jsonb),
            COALESCE(attributes->'port_config', '{}'::jsonb)
        FROM assets
        WHERE attributes->>'asset_type' = 'switch';

        -- Migrate Server Assets
        INSERT INTO server_assets (tenant, asset_id, os_type, os_version, cpu_model, cpu_cores, ram_gb, storage_config, raid_config, is_virtual, hypervisor, network_interfaces, primary_ip, installed_services)
        SELECT 
            tenant,
            asset_id,
            attributes->>'os_type',
            attributes->>'os_version',
            attributes->>'cpu_model',
            (attributes->>'cpu_cores')::integer,
            (attributes->>'ram_gb')::integer,
            COALESCE(attributes->'storage_config', '[]'::jsonb),
            attributes->>'raid_config',
            (attributes->>'is_virtual')::boolean,
            attributes->>'hypervisor',
            COALESCE(attributes->'network_interfaces', '[]'::jsonb),
            attributes->>'primary_ip',
            COALESCE(attributes->'installed_services', '[]'::jsonb)
        FROM assets
        WHERE attributes->>'asset_type' = 'server';

        -- Migrate Mobile Device Assets
        INSERT INTO mobile_device_assets (tenant, asset_id, os_type, os_version, model, imei, phone_number, carrier, is_supervised, installed_apps)
        SELECT 
            tenant,
            asset_id,
            attributes->>'os_type',
            attributes->>'os_version',
            attributes->>'model',
            attributes->>'imei',
            attributes->>'phone_number',
            attributes->>'carrier',
            (attributes->>'is_supervised')::boolean,
            COALESCE(attributes->'installed_apps', '[]'::jsonb)
        FROM assets
        WHERE attributes->>'asset_type' = 'mobile_device';

        -- Migrate Printer Assets
        INSERT INTO printer_assets (tenant, asset_id, model, ip_address, is_network_printer, supports_color, supports_duplex, max_paper_size, supported_paper_types, monthly_duty_cycle, supply_levels)
        SELECT 
            tenant,
            asset_id,
            attributes->>'model',
            attributes->>'ip_address',
            (attributes->>'is_network_printer')::boolean,
            (attributes->>'supports_color')::boolean,
            (attributes->>'supports_duplex')::boolean,
            (attributes->>'max_paper_size')::integer,
            COALESCE(attributes->'supported_paper_types', '[]'::jsonb),
            (attributes->>'monthly_duty_cycle')::integer,
            COALESCE(attributes->'supply_levels', '{}'::jsonb)
        FROM assets
        WHERE attributes->>'asset_type' = 'printer';
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Save data back to JSON attributes before dropping tables
    await knex.raw(`
        -- Save Workstation data
        UPDATE assets a
        SET attributes = jsonb_build_object(
            'asset_type', 'workstation',
            'os_type', w.os_type,
            'os_version', w.os_version,
            'cpu_model', w.cpu_model,
            'cpu_cores', w.cpu_cores,
            'ram_gb', w.ram_gb,
            'storage_type', w.storage_type,
            'storage_capacity_gb', w.storage_capacity_gb,
            'gpu_model', w.gpu_model,
            'installed_software', w.installed_software
        )
        FROM workstation_assets w
        WHERE a.asset_id = w.asset_id AND a.tenant = w.tenant;

        -- Save Network Device data
        UPDATE assets a
        SET attributes = jsonb_build_object(
            'asset_type', 'network_device',
            'device_type', n.device_type,
            'management_ip', n.management_ip,
            'port_count', n.port_count,
            'firmware_version', n.firmware_version,
            'supports_poe', n.supports_poe,
            'vlan_config', n.vlan_config,
            'port_config', n.port_config
        )
        FROM network_device_assets n
        WHERE a.asset_id = n.asset_id AND a.tenant = n.tenant;

        -- Save Server data
        UPDATE assets a
        SET attributes = jsonb_build_object(
            'asset_type', 'server',
            'os_type', s.os_type,
            'os_version', s.os_version,
            'cpu_model', s.cpu_model,
            'cpu_cores', s.cpu_cores,
            'ram_gb', s.ram_gb,
            'storage_config', s.storage_config,
            'raid_config', s.raid_config,
            'is_virtual', s.is_virtual,
            'hypervisor', s.hypervisor,
            'network_interfaces', s.network_interfaces,
            'primary_ip', s.primary_ip,
            'installed_services', s.installed_services
        )
        FROM server_assets s
        WHERE a.asset_id = s.asset_id AND a.tenant = s.tenant;

        -- Save Mobile Device data
        UPDATE assets a
        SET attributes = jsonb_build_object(
            'asset_type', 'mobile_device',
            'os_type', m.os_type,
            'os_version', m.os_version,
            'model', m.model,
            'imei', m.imei,
            'phone_number', m.phone_number,
            'carrier', m.carrier,
            'is_supervised', m.is_supervised,
            'installed_apps', m.installed_apps
        )
        FROM mobile_device_assets m
        WHERE a.asset_id = m.asset_id AND a.tenant = m.tenant;

        -- Save Printer data
        UPDATE assets a
        SET attributes = jsonb_build_object(
            'asset_type', 'printer',
            'model', p.model,
            'ip_address', p.ip_address,
            'is_network_printer', p.is_network_printer,
            'supports_color', p.supports_color,
            'supports_duplex', p.supports_duplex,
            'max_paper_size', p.max_paper_size,
            'supported_paper_types', p.supported_paper_types,
            'monthly_duty_cycle', p.monthly_duty_cycle,
            'supply_levels', p.supply_levels
        )
        FROM printer_assets p
        WHERE a.asset_id = p.asset_id AND a.tenant = p.tenant;
    `);

    // Drop tables in reverse order
    await knex.schema
        .dropTableIfExists('printer_assets')
        .dropTableIfExists('mobile_device_assets')
        .dropTableIfExists('server_assets')
        .dropTableIfExists('network_device_assets')
        .dropTableIfExists('workstation_assets');
};
