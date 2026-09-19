'use strict';

/**
 * Seed inventory workflow events into the global workflow event catalog.
 *
 * The modern workflow catalog reads system_event_catalog for global domain
 * events and uses payload_schema_ref to bind to the event schema registry.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  if (!(await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref'))) {
    await knex.schema.alterTable('system_event_catalog', (t) => {
      t.text('payload_schema_ref').nullable();
      t.index(['payload_schema_ref'], 'idx_system_event_catalog_payload_schema_ref');
    });
  }

  const now = new Date().toISOString();
  const events = [
    {
      event_type: 'INVENTORY_STOCK_LOW',
      name: 'Inventory Stock Low',
      description: 'Triggered when tracked non-serialized stock crosses down to or below its reorder point.',
      category: 'Inventory',
      payload_schema_ref: 'payload.InventoryStockLow.v1',
    },
    {
      event_type: 'INVENTORY_PO_RECEIVED',
      name: 'Inventory Purchase Order Received',
      description: 'Triggered when inventory is received against a purchase order.',
      category: 'Inventory',
      payload_schema_ref: 'payload.InventoryPoReceived.v1',
    },
    {
      event_type: 'INVENTORY_SO_FULFILLED',
      name: 'Inventory Sales Order Fulfilled',
      description: 'Triggered when a sales order is fulfilled from stock or drop ship.',
      category: 'Inventory',
      payload_schema_ref: 'payload.InventorySoFulfilled.v1',
    },
    {
      event_type: 'INVENTORY_RMA_CREATED',
      name: 'Inventory RMA Created',
      description: 'Triggered when a return merchandise authorization is opened.',
      category: 'Inventory',
      payload_schema_ref: 'payload.InventoryRmaCreated.v1',
    },
  ];

  for (const event of events) {
    await knex.raw(
      `
        INSERT INTO system_event_catalog (
          event_id,
          event_type,
          name,
          description,
          category,
          payload_schema_ref,
          created_at,
          updated_at
        )
        VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
        ON CONFLICT (event_type) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          payload_schema_ref = EXCLUDED.payload_schema_ref,
          updated_at = ?::timestamptz
      `,
      [
        event.event_type,
        event.name,
        event.description,
        event.category,
        event.payload_schema_ref,
        now,
        now,
        now,
      ],
    );
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  await knex('system_event_catalog')
    .whereIn('event_type', [
      'INVENTORY_STOCK_LOW',
      'INVENTORY_PO_RECEIVED',
      'INVENTORY_SO_FULFILLED',
      'INVENTORY_RMA_CREATED',
    ])
    .del();
};
