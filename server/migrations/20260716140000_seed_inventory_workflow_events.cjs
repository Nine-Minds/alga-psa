'use strict';

const EVENTS = [
  {
    event_type: 'INVENTORY_SALES_ORDER_CREATED',
    name: 'Inventory Sales Order Created',
    description: 'Triggered when an inventory sales order is created.',
    payload_schema_ref: 'payload.InventorySalesOrderCreated.v1',
  },
  {
    event_type: 'INVENTORY_SALES_ORDER_UPDATED',
    name: 'Inventory Sales Order Updated',
    description: 'Triggered when an inventory sales order or its lines change.',
    payload_schema_ref: 'payload.InventorySalesOrderUpdated.v1',
  },
  {
    event_type: 'INVENTORY_SALES_ORDER_DELETED',
    name: 'Inventory Sales Order Deleted',
    description: 'Triggered when a draft inventory sales order is deleted.',
    payload_schema_ref: 'payload.InventorySalesOrderDeleted.v1',
  },
  {
    event_type: 'INVENTORY_PURCHASE_ORDER_CREATED',
    name: 'Inventory Purchase Order Created',
    description: 'Triggered when an inventory purchase order is created.',
    payload_schema_ref: 'payload.InventoryPurchaseOrderCreated.v1',
  },
  {
    event_type: 'INVENTORY_PURCHASE_ORDER_UPDATED',
    name: 'Inventory Purchase Order Updated',
    description: 'Triggered when an inventory purchase order or its lines change.',
    payload_schema_ref: 'payload.InventoryPurchaseOrderUpdated.v1',
  },
  {
    event_type: 'INVENTORY_PURCHASE_ORDER_DELETED',
    name: 'Inventory Purchase Order Deleted',
    description: 'Triggered when a draft inventory purchase order is deleted.',
    payload_schema_ref: 'payload.InventoryPurchaseOrderDeleted.v1',
  },
  {
    event_type: 'INVENTORY_TRANSFER_DISPATCHED',
    name: 'Inventory Transfer Dispatched',
    description: 'Triggered after stock is dispatched between inventory locations.',
    payload_schema_ref: 'payload.InventoryTransferDispatched.v1',
  },
  {
    event_type: 'INVENTORY_TRANSFER_RECEIVED',
    name: 'Inventory Transfer Received',
    description: 'Triggered after a dispatched stock transfer is received.',
    payload_schema_ref: 'payload.InventoryTransferReceived.v1',
  },
  {
    event_type: 'INVENTORY_COUNT_SUBMITTED',
    name: 'Inventory Count Submitted',
    description: 'Triggered when a cycle count is submitted for review.',
    payload_schema_ref: 'payload.InventoryCountSubmitted.v1',
  },
  {
    event_type: 'INVENTORY_COUNT_APPROVED',
    name: 'Inventory Count Approved',
    description: 'Triggered after a cycle count is approved and its adjustments commit.',
    payload_schema_ref: 'payload.InventoryCountApproved.v1',
  },
].map((event) => ({ ...event, category: 'Inventory' }));

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  if (!(await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref'))) {
    await knex.schema.alterTable('system_event_catalog', (table) => {
      table.text('payload_schema_ref').nullable();
      table.index(['payload_schema_ref'], 'idx_system_event_catalog_payload_schema_ref');
    });
  }

  const now = new Date().toISOString();
  for (const event of EVENTS) {
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
  await knex('system_event_catalog').whereIn(
    'event_type',
    EVENTS.map((event) => event.event_type),
  ).del();
};

exports.EVENTS = EVENTS;
