import { tenantDb } from '@alga-psa/db';
import type {
  IProjectBillingScheduleEntry,
  ProjectBillingScheduleEntryType,
  ProjectBillingScheduleStatus,
  ProjectBillingTriggerType
} from '@alga-psa/types';
import { computeEntryAmounts } from '../services/projectBillingService';
import {
  normalizeProjectBillingScheduleEntry,
  nullableNumberFromDatabase,
  resolveProjectBillingDb,
  withoutUndefined,
  type ProjectBillingDbConnection
} from './projectBillingModelUtils';

export interface CreateProjectBillingScheduleEntryModelInput {
  config_id: string;
  entry_type: ProjectBillingScheduleEntryType;
  description: string;
  amount: number | null;
  percentage: number | null;
  trigger_type: ProjectBillingTriggerType;
  phase_id?: string | null;
  trigger_date?: Date | string | null;
  status?: ProjectBillingScheduleStatus;
  ready_at?: Date | string | null;
  approved_by?: string | null;
  approved_at?: Date | string | null;
  invoice_id?: string | null;
  invoice_charge_id?: string | null;
  display_order?: number;
}

export type UpdateProjectBillingScheduleEntryModelInput = Partial<Omit<
  IProjectBillingScheduleEntry,
  'tenant' | 'schedule_entry_id' | 'config_id' | 'created_at' | 'updated_at'
>>;

export type ProjectBillingStatusTransitionExtra = Partial<Omit<
  IProjectBillingScheduleEntry,
  'tenant' | 'schedule_entry_id' | 'config_id' | 'status' | 'created_at' | 'updated_at'
>>;

export interface ScheduleEntryView extends IProjectBillingScheduleEntry {
  computed_amount: number;
  phase_name: string | null;
  invoice_number: string | null;
  phase_deleted: boolean;
}

export interface ReadyQueueRow {
  entry: ScheduleEntryView;
  project_id: string;
  project_name: string;
  project_number: string;
  client_id: string;
  client_name: string;
  invoice_mode: 'recurring' | 'standalone';
  days_waiting: number;
}

function stableEntrySort(
  left: IProjectBillingScheduleEntry,
  right: IProjectBillingScheduleEntry
): number {
  return left.display_order - right.display_order
    || String(left.created_at).localeCompare(String(right.created_at))
    || left.schedule_entry_id.localeCompare(right.schedule_entry_id);
}

function elapsedWholeDays(readyAt: Date | string | null, now: Date): number {
  if (!readyAt) return 0;
  const readyTime = readyAt instanceof Date ? readyAt.getTime() : new Date(readyAt).getTime();
  if (!Number.isFinite(readyTime)) return 0;
  return Math.max(0, Math.floor((now.getTime() - readyTime) / 86_400_000));
}

const ProjectBillingScheduleEntry = {
  getById: async (
    entryId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingScheduleEntry | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const row = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .first();

    return row
      ? normalizeProjectBillingScheduleEntry(row as Record<string, unknown>)
      : null;
  },

  insert: async (
    input: CreateProjectBillingScheduleEntryModelInput,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingScheduleEntry> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const values = withoutUndefined({
      ...input,
      tenant
    });
    const [row] = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
      .insert(values)
      .returning('*');

    if (!row) {
      throw new Error('Failed to insert project billing schedule entry');
    }
    return normalizeProjectBillingScheduleEntry(row as Record<string, unknown>);
  },

  update: async (
    entryId: string,
    updates: UpdateProjectBillingScheduleEntryModelInput,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingScheduleEntry | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const {
      tenant: _tenant,
      schedule_entry_id: _entryId,
      config_id: _configId,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...mutableUpdates
    } = updates as Partial<IProjectBillingScheduleEntry>;
    const [row] = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .update({
        ...withoutUndefined(mutableUpdates),
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return row
      ? normalizeProjectBillingScheduleEntry(row as Record<string, unknown>)
      : null;
  },

  delete: async (
    entryId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<boolean> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const deleted = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .delete();
    return deleted > 0;
  },

  transitionStatus: async (
    entryId: string,
    from: ProjectBillingScheduleStatus,
    to: ProjectBillingScheduleStatus,
    extra: ProjectBillingStatusTransitionExtra = {},
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingScheduleEntry | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const {
      tenant: _tenant,
      schedule_entry_id: _entryId,
      config_id: _configId,
      status: _status,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...safeExtra
    } = extra as Partial<IProjectBillingScheduleEntry>;
    const [row] = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
      .where({
        schedule_entry_id: entryId,
        status: from
      })
      .update({
        ...withoutUndefined(safeExtra),
        status: to,
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return row
      ? normalizeProjectBillingScheduleEntry(row as Record<string, unknown>)
      : null;
  },

  listByConfig: async (
    configId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingScheduleEntry[]> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const rows = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
      .where({ config_id: configId })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('schedule_entry_id', 'asc');

    return rows.map((row) => normalizeProjectBillingScheduleEntry(row as Record<string, unknown>));
  },

  listByPhase: async (
    phaseId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingScheduleEntry[]> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const rows = await tenantDb(connection, tenant).table('project_billing_schedule_entries')
      .where({ phase_id: phaseId })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('schedule_entry_id', 'asc');

    return rows.map((row) => normalizeProjectBillingScheduleEntry(row as Record<string, unknown>));
  },

  listReadyQueue: async (
    trx?: ProjectBillingDbConnection,
    now: Date = new Date()
  ): Promise<ReadyQueueRow[]> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const db = tenantDb(connection, tenant);
    const query = db.table('project_billing_schedule_entries as e')
      .where('e.status', 'ready')
      .select(
        'e.*',
        'c.total_price as config_total_price',
        'c.invoice_mode',
        'p.project_id',
        'p.project_name',
        'p.project_number',
        'p.client_id',
        'client.client_name',
        'phase.phase_name',
        'invoice.invoice_number'
      )
      .orderBy('e.ready_at', 'asc')
      .orderBy('e.created_at', 'asc')
      .orderBy('e.schedule_entry_id', 'asc');

    db.tenantJoin(query, 'project_billing_configs as c', 'e.config_id', 'c.config_id');
    db.tenantJoin(query, 'projects as p', 'c.project_id', 'p.project_id');
    db.tenantJoin(query, 'clients as client', 'p.client_id', 'client.client_id');
    db.tenantJoin(query, 'project_phases as phase', 'e.phase_id', 'phase.phase_id', { type: 'left' });
    db.tenantJoin(query, 'invoices as invoice', 'e.invoice_id', 'invoice.invoice_id', { type: 'left' });

    const queueRows = await query;
    if (queueRows.length === 0) {
      return [];
    }

    const configIds = Array.from(new Set(queueRows.map((row) => String(row.config_id))));
    const allEntryRows = await db.table('project_billing_schedule_entries')
      .whereIn('config_id', configIds)
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc')
      .orderBy('schedule_entry_id', 'asc');
    const entriesByConfig = new Map<string, IProjectBillingScheduleEntry[]>();

    for (const rawEntry of allEntryRows) {
      const entry = normalizeProjectBillingScheduleEntry(rawEntry as Record<string, unknown>);
      const entries = entriesByConfig.get(entry.config_id) ?? [];
      entries.push(entry);
      entriesByConfig.set(entry.config_id, entries);
    }
    for (const entries of entriesByConfig.values()) {
      entries.sort(stableEntrySort);
    }

    const computedByEntryId = new Map<string, number>();
    const totalPriceByConfig = new Map<string, number | null>();
    for (const row of queueRows) {
      totalPriceByConfig.set(
        String(row.config_id),
        nullableNumberFromDatabase(row.config_total_price)
      );
    }
    for (const [configId, entries] of entriesByConfig) {
      const amounts = computeEntryAmounts(
        { total_price: totalPriceByConfig.get(configId) ?? null },
        entries
      );
      entries.forEach((entry, index) => computedByEntryId.set(entry.schedule_entry_id, amounts[index]));
    }

    return queueRows.map((row): ReadyQueueRow => {
      const {
        config_total_price: _totalPrice,
        invoice_mode,
        project_id,
        project_name,
        project_number,
        client_id,
        client_name,
        phase_name,
        invoice_number,
        ...entryData
      } = row as Record<string, unknown>;
      const entry = normalizeProjectBillingScheduleEntry(entryData);

      return {
        entry: {
          ...entry,
          computed_amount: computedByEntryId.get(entry.schedule_entry_id) ?? 0,
          phase_name: typeof phase_name === 'string' ? phase_name : null,
          invoice_number: typeof invoice_number === 'string' ? invoice_number : null,
          phase_deleted: entry.phase_id !== null && !phase_name
        },
        project_id: String(project_id),
        project_name: String(project_name),
        project_number: String(project_number),
        client_id: String(client_id),
        client_name: String(client_name),
        invoice_mode: invoice_mode as ReadyQueueRow['invoice_mode'],
        days_waiting: elapsedWholeDays(entry.ready_at, now)
      };
    });
  }
};

export default ProjectBillingScheduleEntry;
