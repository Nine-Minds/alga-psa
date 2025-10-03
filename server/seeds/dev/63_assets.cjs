exports.seed = async function(knex) {
    // First delete from extension tables
    await knex('workstation_assets').del();
    await knex('server_assets').del();
    await knex('network_device_assets').del();
    await knex('assets').del();

    const [tenant, clients] = await Promise.all([
        knex('tenants').select('tenant').first(),
        knex('clients').select('client_id', 'client_name')
    ]);

    if (tenant) {
        const emeraldCity = clients.find(c => c.client_name === 'Emerald City');
        const wonderland = clients.find(c => c.client_name === 'Wonderland');
        const now = new Date().toISOString();

        // Create purchase and warranty dates
        const purchaseDate1 = new Date('2023-01-15').toISOString();
        const warrantyDate1 = new Date('2026-01-15').toISOString();
        const purchaseDate2 = new Date('2023-03-20').toISOString();
        const warrantyDate2 = new Date('2026-03-20').toISOString();
        const purchaseDate3 = new Date('2023-02-10').toISOString();
        const warrantyDate3 = new Date('2026-02-10').toISOString();
        const purchaseDate4 = new Date('2023-04-01').toISOString();
        const warrantyDate4 = new Date('2026-04-01').toISOString();
        const purchaseDate5 = new Date('2023-05-15').toISOString();
        const warrantyDate5 = new Date('2026-05-15').toISOString();

        // Insert base assets first
        const assets = [
            // Emerald City Assets
            {
                tenant: tenant.tenant,
                asset_id: '11111111-1111-1111-1111-111111111111',
                asset_type: 'server',
                client_id: emeraldCity.client_id,
                asset_tag: 'EC-SRV-001',
                serial_number: 'RS789012',
                name: 'Ruby Slippers Server',
                status: 'active',
                location: 'Main Data Center',
                purchase_date: purchaseDate1,
                warranty_end_date: warrantyDate1,
                created_at: now,
                updated_at: now
            },
            {
                tenant: tenant.tenant,
                asset_id: '22222222-2222-2222-2222-222222222222',
                asset_type: 'workstation',
                client_id: emeraldCity.client_id,
                asset_tag: 'EC-WS-001',
                serial_number: 'CB456789',
                name: 'Crystal Ball Workstation',
                status: 'active',
                location: 'Wizard\'s Chamber',
                purchase_date: purchaseDate2,
                warranty_end_date: warrantyDate2,
                created_at: now,
                updated_at: now
            },
            {
                tenant: tenant.tenant,
                asset_id: '33333333-3333-3333-3333-333333333333',
                asset_type: 'network_device',
                client_id: emeraldCity.client_id,
                asset_tag: 'EC-NSW-001',
                serial_number: 'YB123456',
                name: 'Yellow Brick Switch',
                status: 'active',
                location: 'Network Room',
                purchase_date: purchaseDate3,
                warranty_end_date: warrantyDate3,
                created_at: now,
                updated_at: now
            },
            // Wonderland Assets
            {
                tenant: tenant.tenant,
                asset_id: '44444444-4444-4444-4444-444444444444',
                asset_type: 'server',
                client_id: wonderland.client_id,
                asset_tag: 'WL-SRV-001',
                serial_number: 'TT987654',
                name: 'Mad Hatter Tea Time Server',
                status: 'active',
                location: 'Tea Party Data Center',
                purchase_date: purchaseDate4,
                warranty_end_date: warrantyDate4,
                created_at: now,
                updated_at: now
            },
            {
                tenant: tenant.tenant,
                asset_id: '55555555-5555-5555-5555-555555555555',
                asset_type: 'workstation',
                client_id: wonderland.client_id,
                asset_tag: 'WL-WS-001',
                serial_number: 'LG789123',
                name: 'Looking Glass Workstation',
                status: 'active',
                location: 'Queen\'s Court',
                purchase_date: purchaseDate5,
                warranty_end_date: warrantyDate5,
                created_at: now,
                updated_at: now
            }
        ];

        await knex('assets').insert(assets);

        // Insert server assets
        const serverAssets = [
            {
                tenant: tenant.tenant,
                asset_id: '11111111-1111-1111-1111-111111111111',
                os_type: 'Linux',
                os_version: 'Ubuntu 22.04 LTS',
                cpu_model: 'Oz EPYC',
                cpu_cores: 64,
                ram_gb: 512,
                storage_config: JSON.stringify([
                    { type: 'SSD', capacity_gb: 48000 }
                ]),
                raid_config: 'RAID 10',
                is_virtual: false,
                network_interfaces: JSON.stringify([
                    { name: 'eth0', speed: '10Gbps' }
                ]),
                primary_ip: '10.0.1.10',
                installed_services: JSON.stringify(['nginx', 'postgresql'])
            },
            {
                tenant: tenant.tenant,
                asset_id: '44444444-4444-4444-4444-444444444444',
                os_type: 'Linux',
                os_version: 'Red Hat 8',
                cpu_model: 'Wonderland EPYC',
                cpu_cores: 32,
                ram_gb: 256,
                storage_config: JSON.stringify([
                    { type: 'SSD', capacity_gb: 24000 }
                ]),
                raid_config: 'RAID 5',
                is_virtual: false,
                network_interfaces: JSON.stringify([
                    { name: 'eth0', speed: '10Gbps' }
                ]),
                primary_ip: '10.0.2.10',
                installed_services: JSON.stringify(['apache', 'mysql'])
            }
        ];

        // Insert workstation assets
        const workstationAssets = [
            {
                tenant: tenant.tenant,
                asset_id: '22222222-2222-2222-2222-222222222222',
                os_type: 'Windows',
                os_version: 'Windows 11 Pro',
                cpu_model: 'Emerald i9',
                cpu_cores: 16,
                ram_gb: 64,
                storage_type: 'NVMe SSD',
                storage_capacity_gb: 2000,
                gpu_model: 'Oz RTX 4090',
                installed_software: JSON.stringify(['Adobe Creative Suite', 'AutoCAD'])
            },
            {
                tenant: tenant.tenant,
                asset_id: '55555555-5555-5555-5555-555555555555',
                os_type: 'Windows',
                os_version: 'Windows 11 Pro',
                cpu_model: 'Cheshire i7',
                cpu_cores: 8,
                ram_gb: 32,
                storage_type: 'NVMe SSD',
                storage_capacity_gb: 1000,
                gpu_model: 'Wonderland RTX 3080',
                installed_software: JSON.stringify(['Office 365', 'Photoshop'])
            }
        ];

        // Insert network device assets
        const networkDeviceAssets = [
            {
                tenant: tenant.tenant,
                asset_id: '33333333-3333-3333-3333-333333333333',
                device_type: 'switch',
                management_ip: '10.0.1.100',
                port_count: 48,
                firmware_version: '2.3.4',
                supports_poe: true,
                power_draw_watts: 150,
                vlan_config: JSON.stringify({
                    '1': 'Management',
                    '10': 'Users',
                    '20': 'Servers'
                }),
                port_config: JSON.stringify({
                    'speed': '100Gbps',
                    'duplex': 'full'
                })
            }
        ];

        await Promise.all([
            knex('server_assets').insert(serverAssets),
            knex('workstation_assets').insert(workstationAssets),
            knex('network_device_assets').insert(networkDeviceAssets)
        ]);
    }
};
