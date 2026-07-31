const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;

    await db.table('invoice_charges').insert([
                {
                    tenant: tenantId,
                    invoice_id: db.table('invoices').where({
                        invoice_number: 'INV-003' 
                    }).select('invoice_id').first(),
                    service_id: db.table('service_catalog').where({
                        service_name: 'Rabbit Tracking' 
                    }).select('service_id').first(),
                    description: 'Advanced Rabbit Tracking Services',
                    quantity: 40,
                    unit_price: 100.00,
                    total_price: 4000.00,
                    net_amount: 4000.00,
                    tax_amount: 0
                },
                {
                    tenant: tenantId,
                    invoice_id: db.table('invoices').where({
                        invoice_number: 'INV-003' 
                    }).select('invoice_id').first(),
                    service_id: db.table('service_catalog').where({
                        service_name: 'Looking Glass Maintenance' 
                    }).select('service_id').first(),
                    description: 'Emergency Looking Glass Repair',
                    quantity: 1,
                    unit_price: 1000.00,
                    total_price: 1000.00,
                    net_amount: 1000.00,
                    tax_amount: 0
                },
                {
                    tenant: tenantId,
                    invoice_id: db.table('invoices').where({
                        invoice_number: 'INV-004' 
                    }).select('invoice_id').first(),
                    service_id: db.table('service_catalog').where({
                        service_name: 'Yellow Brick Road Repair' 
                    }).select('service_id').first(),
                    description: 'Major Yellow Brick Road Overhaul',
                    quantity: 1,
                    unit_price: 10000.00,
                    total_price: 10000.00,
                    net_amount: 10000.00,
                    tax_amount: 0
                },
                {
                    tenant: tenantId,
                    invoice_id: db.table('invoices').where({
                        invoice_number: 'INV-004' 
                    }).select('invoice_id').first(),
                    service_id: db.table('service_catalog').where({
                        service_name: 'Emerald City Security' 
                    }).select('service_id').first(),
                    description: 'Enhanced Security Package',
                    quantity: 1,
                    unit_price: 2000.00,
                    total_price: 2000.00,
                    net_amount: 2000.00,
                    tax_amount: 0
                },
                {
                    tenant: tenantId,
                    invoice_id: db.table('invoices').where({
                        invoice_number: 'INV-005' 
                    }).select('invoice_id').first(),
                    service_id: db.table('service_catalog').where({
                        service_name: 'Rabbit Tracking' 
                    }).select('service_id').first(),
                    description: 'Premium Rabbit Tracking Services',
                    quantity: 50,
                    unit_price: 125.00,
                    total_price: 6250.00,
                    net_amount: 6250.00,
                    tax_amount: 0
                },
                {
                    tenant: tenantId,
                    invoice_id: db.table('invoices').where({
                        invoice_number: 'INV-005' 
                    }).select('invoice_id').first(),
                    service_id: db.table('service_catalog').where({
                        service_name: 'Looking Glass Maintenance' 
                    }).select('service_id').first(),
                    description: 'Monthly Looking Glass Maintenance',
                    quantity: 1,
                    unit_price: 1250.00,
                    total_price: 1250.00,
                    net_amount: 1250.00,
                    tax_amount: 0
                }
            ]);
};
