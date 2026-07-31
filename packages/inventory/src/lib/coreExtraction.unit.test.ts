import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { adjustStockCore } from './adjust';
import { receivePoLineCore } from './purchaseOrders';
import { receiveStockCore } from './receive';

interface MemoryState {
  tenant: string;
  serviceId: string;
  locationId: string;
  settings: Record<string, any>;
  location: Record<string, any>;
  level: Record<string, any> | null;
  movements: Array<Record<string, any>>;
  po?: Record<string, any>;
  poLine?: Record<string, any>;
}

/** Minimal transaction-shaped harness for fast, session-free core tests. */
function memoryTransaction(state: MemoryState): Knex.Transaction {
  class Query {
    private criteria: Record<string, any> = {};
    private insertRow: Record<string, any> | null = null;
    private aggregate: string | null = null;

    constructor(private readonly table: string) {}

    where(criteria: Record<string, any>): this {
      Object.assign(this.criteria, criteria);
      return this;
    }

    select(): this {
      return this;
    }

    join(): this {
      return this;
    }

    forUpdate(): this {
      return this;
    }

    sum(column: string): this {
      this.aggregate = column;
      return this;
    }

    insert(row: Record<string, any>): this {
      this.insertRow = row;
      return this;
    }

    onConflict(): this {
      return this;
    }

    async ignore(): Promise<void> {
      if (this.table === 'stock_levels' && !state.level && this.insertRow) {
        state.level = { ...this.insertRow };
      }
    }

    async first(): Promise<any> {
      if (this.table === 'product_inventory_settings') return state.settings;
      if (this.table === 'stock_locations') return state.location;
      if (this.table === 'purchase_orders') return state.po;
      if (this.table === 'purchase_order_lines') return state.poLine;
      if (this.table === 'stock_levels') {
        if (this.aggregate) return { s: state.level?.quantity_on_hand ?? 0 };
        return state.level;
      }
      if (this.table === 'stock_levels as sl') {
        if (!state.level) return undefined;
        return {
          ...state.level,
          service_name: 'Core product',
          sku: 'CORE-1',
          location_name: 'Core location',
          track_stock: state.settings.track_stock,
          is_serialized: state.settings.is_serialized,
          reorder_point: state.level.reorder_point ?? state.settings.reorder_point ?? null,
        };
      }
      return undefined;
    }

    async returning(): Promise<any[]> {
      if (!this.insertRow) return [];
      if (this.table === 'stock_movements') {
        const movement = {
          movement_id: `movement-${state.movements.length + 1}`,
          created_at: new Date('2026-07-16T00:00:00.000Z'),
          ...this.insertRow,
        };
        state.movements.push(movement);
        return [movement];
      }
      return [{ ...this.insertRow }];
    }

    async update(patch: Record<string, any>): Promise<number> {
      if (this.table === 'stock_levels' && state.level) {
        for (const [key, value] of Object.entries(patch)) {
          if (value && typeof value === 'object' && value.__raw === 'quantity_on_hand + ?') {
            state.level[key] = Number(state.level[key] ?? 0) + Number(value.bindings[0]);
          } else {
            state.level[key] = value;
          }
        }
        return 1;
      }
      if (this.table === 'product_inventory_settings') {
        Object.assign(state.settings, patch);
        return 1;
      }
      return 0;
    }
  }

  const trx = ((table: string) => new Query(table)) as unknown as Knex.Transaction;
  (trx as any).fn = { now: () => new Date('2026-07-16T00:00:00.000Z') };
  (trx as any).raw = (sql: string, bindings: unknown[]) => ({ __raw: sql, bindings });
  return trx;
}

function baseState(): MemoryState {
  return {
    tenant: 'tenant-core',
    serviceId: 'service-core',
    locationId: 'location-core',
    settings: {
      tenant: 'tenant-core',
      service_id: 'service-core',
      track_stock: true,
      is_serialized: false,
      average_cost: 1000,
      cost_currency: 'USD',
    },
    location: {
      tenant: 'tenant-core',
      location_id: 'location-core',
      assigned_user_id: null,
      manager_user_id: null,
    },
    level: null,
    movements: [],
  };
}

describe('session-free inventory cores', () => {
  it('T006: receive and adjust accept only trx/tenant/user/input and maintain movements plus levels', async () => {
    const state = baseState();
    const trx = memoryTransaction(state);
    const received = await receiveStockCore(trx, state.tenant, 'user-core', {
      service_id: state.serviceId,
      location_id: state.locationId,
      quantity: 4,
      unit_cost: 1500,
    });
    expect(received.movements).toHaveLength(1);
    expect(received.movements[0]).toMatchObject({
      movement_type: 'receipt',
      quantity: 4,
      performed_by: 'user-core',
    });
    expect(state.level?.quantity_on_hand).toBe(4);
    expect(state.settings.average_cost).toBe(1500);

    const adjusted = await adjustStockCore(trx, state.tenant, 'user-core', {
      service_id: state.serviceId,
      location_id: state.locationId,
      delta: -2,
      reason: 'session-free adjustment',
    });
    expect(adjusted.movements).toHaveLength(1);
    expect(adjusted.movements[0]).toMatchObject({
      movement_type: 'adjust',
      quantity: 2,
      from_location_id: state.locationId,
      reason: 'session-free adjustment',
      performed_by: 'user-core',
    });
    expect(state.level?.quantity_on_hand).toBe(2);
    expect(state.movements).toHaveLength(2);
  });

  it('T007: PO receive traverses assertLocationWritable and rejects another technician\'s van', async () => {
    const state = baseState();
    state.location.assigned_user_id = 'van-owner';
    state.po = {
      tenant: state.tenant,
      po_id: 'po-core',
      po_number: 'PO-CORE',
      vendor_id: null,
      status: 'open',
      currency_code: 'USD',
    };
    state.poLine = {
      tenant: state.tenant,
      po_line_id: 'po-line-core',
      po_id: 'po-core',
      service_id: state.serviceId,
      quantity_ordered: 1,
      quantity_received: 0,
      unit_cost: 1000,
      cost_currency: 'USD',
    };

    await expect(
      receivePoLineCore(memoryTransaction(state), state.tenant, 'different-tech', {
        po_line_id: 'po-line-core',
        location_id: state.locationId,
        quantity: 1,
      }),
    ).rejects.toThrow("Permission denied: this location is a technician's van assigned to someone else");
    expect(state.movements).toEqual([]);
  });

  it('T065: adjust exposes STOCK_LOW only on the downward reorder crossing', async () => {
    const state = baseState();
    state.settings.reorder_point = 3;
    state.level = {
      tenant: state.tenant,
      service_id: state.serviceId,
      location_id: state.locationId,
      quantity_on_hand: 5,
      reserved_quantity: 0,
      held_quantity: 0,
      reorder_point: null,
    };
    const trx = memoryTransaction(state);

    const crossing = await adjustStockCore(trx, state.tenant, 'user-core', {
      service_id: state.serviceId,
      location_id: state.locationId,
      delta: -2,
      reason: 'cross threshold',
    });
    expect(crossing.pending_stock_low_event).toMatchObject({
      tenant: state.tenant,
      service_id: state.serviceId,
      location_id: state.locationId,
      on_hand: 3,
      reorder_point: 3,
    });

    const alreadyLow = await adjustStockCore(trx, state.tenant, 'user-core', {
      service_id: state.serviceId,
      location_id: state.locationId,
      delta: -1,
      reason: 'stay below threshold',
    });
    expect(alreadyLow.pending_stock_low_event).toBeNull();
  });
});
