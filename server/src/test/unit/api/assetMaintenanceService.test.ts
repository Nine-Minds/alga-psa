import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMaintenanceScheduleSchema } from '../../../lib/api/schemas/asset';

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state: Record<string, Row[]> = {};
  const failures = new Set<string>();
  class Query {
    private filters: Row[] = [];
    constructor(private table: string) {}
    where(filter: Row) { this.filters.push(filter); return this; }
    forUpdate() { return this; }
    private rows() {
      return (state[this.table] ?? []).filter((row) =>
        this.filters.every((filter) => Object.entries(filter).every(([key, value]) => row[key] === value)));
    }
    async first() {
      const row = this.rows()[0];
      return row ? { ...row } : undefined;
    }
    insert(data: Row) {
      if (failures.has(this.table)) throw new Error(`Insert failed: ${this.table}`);
      const row = {
        ...(this.table === 'asset_maintenance_schedules' ? { schedule_id: 'schedule-new', is_active: true } : {}),
        ...data,
      };
      (state[this.table] ??= []).push(row);
      return Object.assign(Promise.resolve([row]), {
        returning: () => Promise.resolve([row]),
        onConflict: () => ({ ignore: () => Promise.resolve([row]) }),
      });
    }
    update(data: Row) {
      if (failures.has(this.table)) throw new Error(`Update failed: ${this.table}`);
      const rows = this.rows();
      rows.forEach((row) => Object.assign(row, data));
      return Object.assign(Promise.resolve(rows.length), { returning: () => Promise.resolve(rows) });
    }
  }
  const knex = {
    raw: (_sql: string, bindings: string[]) => JSON.parse(bindings[0]),
    transaction: vi.fn(async (callback: (trx: unknown) => Promise<unknown>) => {
      const before = structuredClone(state);
      try {
        return await callback(knex);
      } catch (error) {
        for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, before);
        throw error;
      }
    }),
  };
  return { state, failures, knex, Query };
});

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  BaseService: class {
    protected tableName = 'assets';
    protected primaryKey = 'asset_id';
    protected async getDbForContext() { return h.knex; }
  },
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (table: string) => new h.Query(table).where({ tenant }),
  }),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

import { AssetService } from '../../../lib/api/services/AssetService';

const context = { tenant: 'tenant-one', userId: 'user-one' };
const data = createMaintenanceScheduleSchema.parse({
  schedule_name: 'Biannual maintenance', maintenance_type: 'preventive',
  frequency: 'monthly', frequency_interval: 6, schedule_config: {},
  next_maintenance: '2027-01-15T13:00:00.000Z',
});
const schedules = 'asset_maintenance_schedules';
const occurrences = 'asset_maintenance_occurrences';
const notifications = 'asset_maintenance_notifications';

beforeEach(() => {
  for (const key of Object.keys(h.state)) delete h.state[key];
  h.failures.clear();
  h.knex.transaction.mockClear();
  h.state.assets = [{ asset_id: 'asset-one', tenant: context.tenant }];
  h.state[schedules] = [];
  h.state[occurrences] = [];
  h.state[notifications] = [];
});

describe('AssetService maintenance writes', () => {
  it('writes the canonical columns and authenticated creator, plus notification and open occurrence', async () => {
    const row = await new AssetService().createMaintenanceSchedule('asset-one', data, context);
    expect(row).toMatchObject({
      ...data, description: null, tenant: context.tenant, asset_id: 'asset-one', created_by: context.userId,
    });
    for (const field of ['schedule_type', 'notes', 'start_date', 'assigned_to', 'end_date']) {
      expect(row).not.toHaveProperty(field);
    }
    expect(h.state[occurrences]).toEqual([expect.objectContaining({
      schedule_id: row.schedule_id, due_date: data.next_maintenance, status: 'open', tenant: context.tenant,
    })]);
    expect(h.state[notifications][0]).toMatchObject({
      notification_date: data.next_maintenance,
      notification_data: { schedule_name: data.schedule_name, maintenance_type: data.maintenance_type },
    });
    expect(h.knex.transaction).toHaveBeenCalledOnce();
  });

  it('does not create an occurrence for an inactive schedule', async () => {
    await new AssetService().createMaintenanceSchedule('asset-one', { ...data, is_active: false }, context);
    expect(h.state[occurrences]).toHaveLength(0);
  });

  it.each([notifications, occurrences])('rolls back all creation writes if %s fails', async (table) => {
    h.failures.add(table);
    await expect(new AssetService().createMaintenanceSchedule('asset-one', data, context)).rejects.toThrow('Insert failed');
    expect(h.state[schedules]).toHaveLength(0);
    expect(h.state[notifications]).toHaveLength(0);
    expect(h.state[occurrences]).toHaveLength(0);
  });

  it('rejects a custom frequency without a recurrence rule, before and after merging with the stored row', async () => {
    const service = new AssetService();
    await expect(service.createMaintenanceSchedule('asset-one', { ...data, frequency: 'custom' }, context))
      .rejects.toThrow('requires schedule_config.recurrence');
    expect(h.state[schedules]).toHaveLength(0);

    const recurrence = { unit: 'months', days_of_month: [1, 15] };
    const row = await service.createMaintenanceSchedule(
      'asset-one', { ...data, frequency: 'custom', schedule_config: { recurrence } }, context);
    expect(row.schedule_config).toEqual({ recurrence });

    await expect(service.updateMaintenanceSchedule(row.schedule_id, { schedule_config: { checklist: [] } }, context))
      .rejects.toThrow('requires schedule_config.recurrence');
    expect(h.state[schedules][0].schedule_config).toEqual({ recurrence });
    await service.updateMaintenanceSchedule(row.schedule_id, { frequency: 'monthly', schedule_config: {} }, context);
    await expect(service.updateMaintenanceSchedule(row.schedule_id, { frequency: 'custom' }, context))
      .rejects.toThrow('requires schedule_config.recurrence');
  });

  it('rejects assets from another tenant before writing', async () => {
    h.state.assets[0].tenant = 'tenant-two';
    await expect(new AssetService().createMaintenanceSchedule('asset-one', data, context)).rejects.toThrow('Asset not found');
    expect(h.state[schedules]).toHaveLength(0);
  });

  it('preserves the due date and inactive state when only frequency changes', async () => {
    const service = new AssetService();
    await service.createMaintenanceSchedule('asset-one', { ...data, is_active: false }, context);
    const row = await service.updateMaintenanceSchedule('schedule-new', { frequency_interval: 3 }, context);
    expect(row.next_maintenance).toBe(data.next_maintenance);
    expect(row.is_active).toBe(false);
    expect(h.state[occurrences]).toHaveLength(0);
  });

  it('synchronizes rescheduling, cancels on disable, and creates an occurrence on re-enable', async () => {
    const service = new AssetService();
    await service.createMaintenanceSchedule('asset-one', data, context);
    h.state[notifications][0].is_sent = false;
    const next_maintenance = '2027-02-01T12:00:00.000Z';
    await service.updateMaintenanceSchedule('schedule-new', { next_maintenance, schedule_name: 'Revised' }, context);
    expect(h.state[occurrences][0].due_date).toBe(next_maintenance);
    expect(h.state[notifications][0]).toMatchObject({
      notification_date: next_maintenance, notification_data: { schedule_name: 'Revised' },
    });
    await service.updateMaintenanceSchedule('schedule-new', { is_active: false }, context);
    expect(h.state[occurrences][0]).toMatchObject({ status: 'cancelled', closed_by: context.userId });
    await service.updateMaintenanceSchedule('schedule-new', { is_active: true }, context);
    expect(h.state[occurrences].filter((row) => row.status === 'open')).toHaveLength(1);
  });

  it('does not reopen an archived schedule', async () => {
    const service = new AssetService();
    await service.createMaintenanceSchedule('asset-one', { ...data, is_active: false }, context);
    h.state[schedules][0].archived_at = new Date();
    await service.updateMaintenanceSchedule('schedule-new', { is_active: true }, context);
    expect(h.state[occurrences]).toHaveLength(0);
  });

  it('rolls back the schedule update when synchronizing an occurrence fails', async () => {
    const service = new AssetService();
    await service.createMaintenanceSchedule('asset-one', data, context);
    h.failures.add(occurrences);
    await expect(service.updateMaintenanceSchedule('schedule-new', { next_maintenance: '2027-02-01T12:00:00.000Z' }, context))
      .rejects.toThrow('Update failed');
    expect(h.state[schedules][0].next_maintenance).toBe(data.next_maintenance);
  });

  it('returns not found for missing or cross-tenant schedules', async () => {
    const service = new AssetService();
    await service.createMaintenanceSchedule('asset-one', data, context);
    await expect(service.updateMaintenanceSchedule('missing', { description: 'Edit' }, context))
      .rejects.toThrow('Maintenance schedule not found');
    await expect(service.updateMaintenanceSchedule('schedule-new', { description: 'Edit' }, { ...context, tenant: 'tenant-two' }))
      .rejects.toThrow('Maintenance schedule not found');
  });
});
