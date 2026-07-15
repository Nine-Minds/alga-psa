'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type {
  IProjectBillingConfig,
  IProjectBillingScheduleEntry,
  IUserWithRoles,
  ProjectBillingScheduleStatus,
} from '@alga-psa/types';
import type { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import ProjectBillingConfig from '../models/projectBillingConfig';
import ProjectBillingScheduleEntry from '../models/projectBillingScheduleEntry';
import {
  createProjectBillingScheduleEntrySchema,
} from '../schemas/projectBillingSchemas';
import { computeEntryAmounts, validateAllocation } from '../services/projectBillingService';
import { generateProjectInvoice } from './invoiceGeneration';
import {
  assertProjectBillingMutationPermission,
  type ReadyQueueRow,
  type ScheduleEntryView,
} from './projectBillingConfigActions';

export interface CreateScheduleEntryActionInput {
  entry_type: 'milestone' | 'deposit';
  description: string;
  amount?: number;
  percentage?: number;
  trigger_type: 'phase' | 'date' | 'manual';
  phase_id?: string | null;
  trigger_date?: string | null;
}

export type UpdateScheduleEntryActionInput = Partial<CreateScheduleEntryActionInput>;

interface EntryContext {
  entry: IProjectBillingScheduleEntry;
  config: IProjectBillingConfig;
  projectId: string;
}

interface ApprovedEntryResult {
  entry: ScheduleEntryView;
  allocation_warning: string | null;
  projectId: string;
}

function revalidateProjectBilling(projectId: string): void {
  revalidatePath(`/msp/projects/${projectId}`);
  revalidatePath('/msp/billing');
}

async function assertBillingReadPermission(user: IUserWithRoles): Promise<void> {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: Cannot view project billing');
  }
}

async function loadEntryContext(
  connection: Knex | Knex.Transaction,
  entryId: string,
): Promise<EntryContext> {
  const entry = await ProjectBillingScheduleEntry.getById(entryId, connection);
  if (!entry) throw new Error('Project billing schedule entry not found');
  const config = await ProjectBillingConfig.getById(entry.config_id, connection);
  if (!config) throw new Error('Project billing config not found');
  return { entry, config, projectId: config.project_id };
}

async function assertValidTrigger(
  connection: Knex | Knex.Transaction,
  tenant: string,
  projectId: string,
  input: {
    trigger_type: 'phase' | 'date' | 'manual';
    phase_id: string | null;
    trigger_date: Date | string | null;
  },
): Promise<void> {
  if (input.trigger_type === 'phase') {
    if (!input.phase_id) throw new Error('phase_id is required for a phase trigger');
    const phase = await tenantDb(connection, tenant).table('project_phases')
      .where({ phase_id: input.phase_id, project_id: projectId })
      .select('phase_id')
      .first();
    if (!phase) throw new Error('Selected phase does not belong to this project');
    if (input.trigger_date != null) throw new Error('trigger_date is only valid for a date trigger');
    return;
  }

  if (input.trigger_type === 'date') {
    if (!input.trigger_date) throw new Error('trigger_date is required for a date trigger');
    if (input.phase_id != null) throw new Error('phase_id is only valid for a phase trigger');
    return;
  }

  if (input.phase_id != null || input.trigger_date != null) {
    throw new Error('Manual triggers cannot have a phase or trigger date');
  }
}

async function scheduleEntryView(
  connection: Knex | Knex.Transaction,
  tenant: string,
  entryId: string,
  config?: IProjectBillingConfig,
): Promise<ScheduleEntryView> {
  const context = config
    ? { entry: await ProjectBillingScheduleEntry.getById(entryId, connection), config }
    : await loadEntryContext(connection, entryId);
  if (!context.entry) throw new Error('Project billing schedule entry not found');
  const entries = await ProjectBillingScheduleEntry.listByConfig(context.config.config_id, connection);
  const entryIndex = entries.findIndex((entry) => entry.schedule_entry_id === entryId);
  if (entryIndex < 0) throw new Error('Project billing schedule entry not found');
  const amounts = computeEntryAmounts(context.config, entries);
  const [phase, invoice] = await Promise.all([
    context.entry.phase_id
      ? tenantDb(connection, tenant).table('project_phases')
        .where({ phase_id: context.entry.phase_id })
        .select('phase_name')
        .first<{ phase_name: string }>()
      : null,
    context.entry.invoice_id
      ? tenantDb(connection, tenant).table('invoices')
        .where({ invoice_id: context.entry.invoice_id })
        .select('invoice_number')
        .first<{ invoice_number: string }>()
      : null,
  ]);
  const phaseDeleted = context.entry.trigger_type === 'phase'
    && (context.entry.phase_id === null || !phase);
  return {
    ...context.entry,
    trigger_type: phaseDeleted ? 'manual' : context.entry.trigger_type,
    computed_amount: amounts[entryIndex],
    phase_name: phase?.phase_name ?? null,
    invoice_number: invoice?.invoice_number ?? null,
    phase_deleted: phaseDeleted,
  };
}

function allocationWarning(delta: number): string {
  const direction = delta > 0 ? 'under-allocated' : 'over-allocated';
  return `Schedule is ${direction} by ${Math.abs(delta)} cents.`;
}

async function approveEntryInTransaction(
  user: IUserWithRoles,
  tenant: string,
  trx: Knex.Transaction,
  entryId: string,
): Promise<ApprovedEntryResult> {
  const context = await loadEntryContext(trx, entryId);
  if (context.entry.status !== 'ready') {
    throw new Error('Only ready schedule entries can be approved');
  }

  const entries = await ProjectBillingScheduleEntry.listByConfig(context.config.config_id, trx);
  const allocation = validateAllocation(context.config, entries);
  if (allocation.isFinalEntryBlocked) {
    throw new Error(allocationWarning(allocation.delta));
  }

  const approvedAt = new Date().toISOString();
  const approved = await ProjectBillingScheduleEntry.transitionStatus(
    entryId,
    'ready',
    'approved',
    {
      approved_by: user.user_id,
      approved_at: approvedAt,
    },
    trx,
  );
  if (!approved) {
    throw new Error('Schedule entry status changed before it could be approved');
  }

  return {
    entry: await scheduleEntryView(trx, tenant, entryId, context.config),
    allocation_warning: allocation.ok ? null : allocationWarning(allocation.delta),
    projectId: context.projectId,
  };
}

async function transitionEntry(
  tenant: string,
  trx: Knex.Transaction,
  entryId: string,
  from: ProjectBillingScheduleStatus,
  to: ProjectBillingScheduleStatus,
  extra: Partial<IProjectBillingScheduleEntry> = {},
): Promise<{ entry: ScheduleEntryView; projectId: string }> {
  const context = await loadEntryContext(trx, entryId);
  if (context.entry.status !== from) {
    throw new Error(`Schedule entry must be ${from} before it can become ${to}`);
  }
  const transitioned = await ProjectBillingScheduleEntry.transitionStatus(
    entryId,
    from,
    to,
    extra,
    trx,
  );
  if (!transitioned) {
    throw new Error(`Schedule entry status changed before it could become ${to}`);
  }
  return {
    entry: await scheduleEntryView(trx, tenant, entryId, context.config),
    projectId: context.projectId,
  };
}

function invoiceIdFrom(result: unknown): string {
  if (result && typeof result === 'object') {
    const invoiceId = (result as Record<string, unknown>).invoice_id;
    if (typeof invoiceId === 'string' && invoiceId.length > 0) return invoiceId;

    const actionError = (result as Record<string, unknown>).actionError;
    const permissionError = (result as Record<string, unknown>).permissionError;
    if (typeof actionError === 'string') throw new Error(actionError);
    if (typeof permissionError === 'string') throw new Error(permissionError);
  }
  throw new Error('Project invoice generation did not return an invoice');
}

export const createScheduleEntry = withAuth(async (
  user,
  { tenant },
  configId: string,
  input: CreateScheduleEntryActionInput,
): Promise<ScheduleEntryView> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const parsed = createProjectBillingScheduleEntrySchema.parse({
    ...input,
    config_id: configId,
    amount: input.amount ?? null,
    percentage: input.percentage ?? null,
    phase_id: input.phase_id ?? null,
    trigger_date: input.trigger_date ?? null,
    status: 'pending',
  });

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const config = await ProjectBillingConfig.getById(configId, trx);
    if (!config) throw new Error('Project billing config not found');
    await assertValidTrigger(trx, tenant, config.project_id, {
      trigger_type: parsed.trigger_type,
      phase_id: parsed.phase_id ?? null,
      trigger_date: parsed.trigger_date ?? null,
    });
    const lastEntry = await tenantDb(trx, tenant).table('project_billing_schedule_entries')
      .where({ config_id: configId })
      .max<{ max_order: string | number | null }>({ max_order: 'display_order' })
      .first();
    const displayOrder = Number(lastEntry?.max_order ?? -1) + 1;
    const entry = await ProjectBillingScheduleEntry.insert({
      config_id: configId,
      entry_type: parsed.entry_type,
      description: parsed.description,
      amount: parsed.amount ?? null,
      percentage: parsed.percentage ?? null,
      trigger_type: parsed.trigger_type,
      phase_id: parsed.phase_id ?? null,
      trigger_date: parsed.trigger_date ?? null,
      status: 'pending',
      display_order: displayOrder,
    }, trx);
    return {
      entry: await scheduleEntryView(trx, tenant, entry.schedule_entry_id, config),
      projectId: config.project_id,
    };
  });
  revalidateProjectBilling(result.projectId);
  return result.entry;
});

export const updateScheduleEntry = withAuth(async (
  user,
  { tenant },
  entryId: string,
  updates: UpdateScheduleEntryActionInput,
): Promise<ScheduleEntryView> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const context = await loadEntryContext(trx, entryId);
    if (context.entry.status !== 'pending') {
      throw new Error('Only pending schedule entries can be edited');
    }

    const amountProvided = updates.amount !== undefined;
    const percentageProvided = updates.percentage !== undefined;
    if (amountProvided && percentageProvided) {
      throw new Error('Exactly one of amount or percentage can be set');
    }
    const amount = amountProvided
      ? updates.amount ?? null
      : percentageProvided ? null : context.entry.amount;
    const percentage = percentageProvided
      ? updates.percentage ?? null
      : amountProvided ? null : context.entry.percentage;
    const existingTriggerType = context.entry.trigger_type === 'phase' && context.entry.phase_id === null
      ? 'manual'
      : context.entry.trigger_type;
    const triggerType = updates.trigger_type ?? existingTriggerType;
    const phaseId = triggerType === 'phase'
      ? updates.phase_id !== undefined ? updates.phase_id : context.entry.phase_id
      : null;
    const triggerDate = triggerType === 'date'
      ? updates.trigger_date !== undefined ? updates.trigger_date : context.entry.trigger_date
      : null;

    const parsed = createProjectBillingScheduleEntrySchema.parse({
      config_id: context.entry.config_id,
      entry_type: updates.entry_type ?? context.entry.entry_type,
      description: updates.description ?? context.entry.description,
      amount,
      percentage,
      trigger_type: triggerType,
      phase_id: phaseId,
      trigger_date: triggerDate,
      status: 'pending',
      display_order: context.entry.display_order,
    });
    await assertValidTrigger(trx, tenant, context.projectId, {
      trigger_type: parsed.trigger_type,
      phase_id: parsed.phase_id ?? null,
      trigger_date: parsed.trigger_date ?? null,
    });

    const updated = await ProjectBillingScheduleEntry.update(entryId, {
      entry_type: parsed.entry_type,
      description: parsed.description,
      amount: parsed.amount ?? null,
      percentage: parsed.percentage ?? null,
      trigger_type: parsed.trigger_type,
      phase_id: parsed.phase_id ?? null,
      trigger_date: parsed.trigger_date ?? null,
    }, trx);
    if (!updated) throw new Error('Project billing schedule entry not found');
    return {
      entry: await scheduleEntryView(trx, tenant, entryId, context.config),
      projectId: context.projectId,
    };
  });
  revalidateProjectBilling(result.projectId);
  return result.entry;
});

export const deleteScheduleEntry = withAuth(async (
  user,
  { tenant: _tenant },
  entryId: string,
): Promise<void> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const projectId = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const context = await loadEntryContext(trx, entryId);
    if (context.entry.status !== 'pending' && context.entry.status !== 'canceled') {
      throw new Error('Only pending or canceled schedule entries can be deleted');
    }
    if (!await ProjectBillingScheduleEntry.delete(entryId, trx)) {
      throw new Error('Project billing schedule entry not found');
    }
    return context.projectId;
  });
  revalidateProjectBilling(projectId);
});

export const markEntryReady = withAuth(async (
  user,
  { tenant },
  entryId: string,
): Promise<ScheduleEntryView> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const context = await loadEntryContext(trx, entryId);
    const deletedPhaseFallback = context.entry.trigger_type === 'phase'
      && context.entry.phase_id === null;
    if (context.entry.trigger_type !== 'manual' && !deletedPhaseFallback) {
      throw new Error('Only manual schedule entries can be marked ready');
    }
    return transitionEntry(tenant, trx, entryId, 'pending', 'ready', {
      ready_at: new Date().toISOString(),
    });
  });
  await publishEvent({
    eventType: 'PROJECT_MILESTONE_READY',
    payload: {
      tenantId: tenant,
      projectId: result.projectId,
      entryId: result.entry.schedule_entry_id,
      description: result.entry.description,
      computedAmount: result.entry.computed_amount,
      trigger: 'manual',
    },
  });
  revalidateProjectBilling(result.projectId);
  return result.entry;
});

export const approveScheduleEntry = withAuth(async (
  user,
  { tenant },
  entryId: string,
): Promise<{ entry: ScheduleEntryView; allocation_warning: string | null }> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const result = await withTransaction(knex, (trx: Knex.Transaction) => (
    approveEntryInTransaction(user, tenant, trx, entryId)
  ));
  revalidateProjectBilling(result.projectId);
  return { entry: result.entry, allocation_warning: result.allocation_warning };
});

export const approveAndInvoiceNow = withAuth(async (
  user,
  { tenant },
  entryId: string,
): Promise<{ entry: ScheduleEntryView; invoice_id: string }> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const approved = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const context = await loadEntryContext(trx, entryId);
    if (context.config.invoice_mode !== 'standalone') {
      throw new Error('Approve and invoice now is only available for standalone project billing');
    }
    return approveEntryInTransaction(user, tenant, trx, entryId);
  });

  const invoice = await generateProjectInvoice(approved.projectId, [entryId]);
  const invoiceId = invoiceIdFrom(invoice);
  const entry = await scheduleEntryView(knex, tenant, entryId);
  revalidateProjectBilling(approved.projectId);
  return { entry, invoice_id: invoiceId };
});

export const holdScheduleEntry = withAuth(async (
  user,
  { tenant },
  entryId: string,
  reason: string,
): Promise<ScheduleEntryView> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  if (!reason.trim()) throw new Error('A hold reason is required');
  const result = await withTransaction(knex, (trx: Knex.Transaction) => (
    transitionEntry(tenant, trx, entryId, 'ready', 'pending', { ready_at: null })
  ));
  revalidateProjectBilling(result.projectId);
  return result.entry;
});

export const cancelScheduleEntry = withAuth(async (
  user,
  { tenant },
  entryId: string,
): Promise<ScheduleEntryView> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const context = await loadEntryContext(trx, entryId);
    if (context.entry.status === 'invoiced') {
      throw new Error('Invoiced schedule entries cannot be canceled');
    }
    if (context.entry.status === 'canceled') {
      return {
        entry: await scheduleEntryView(trx, tenant, entryId, context.config),
        projectId: context.projectId,
      };
    }
    return transitionEntry(
      tenant,
      trx,
      entryId,
      context.entry.status,
      'canceled',
    );
  });
  revalidateProjectBilling(result.projectId);
  return result.entry;
});

export const bulkApproveEntries = withAuth(async (
  user,
  { tenant },
  entryIds: string[],
): Promise<{ approved: string[]; failed: { id: string; error: string }[] }> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  const approved: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const id of entryIds) {
    try {
      const result = await withTransaction(knex, (trx: Knex.Transaction) => (
        approveEntryInTransaction(user, tenant, trx, id)
      ));
      approved.push(id);
      revalidateProjectBilling(result.projectId);
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { approved, failed };
});

export const bulkHoldEntries = withAuth(async (
  user,
  { tenant },
  entryIds: string[],
  reason: string,
): Promise<{ held: string[]; failed: { id: string; error: string }[] }> => {
  const { knex } = await createTenantKnex();
  await assertProjectBillingMutationPermission(user, knex);
  if (!reason.trim()) throw new Error('A hold reason is required');
  const held: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const id of entryIds) {
    try {
      const result = await withTransaction(knex, (trx: Knex.Transaction) => (
        transitionEntry(tenant, trx, id, 'ready', 'pending', { ready_at: null })
      ));
      held.push(id);
      revalidateProjectBilling(result.projectId);
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { held, failed };
});

export const listReadyScheduleEntries = withAuth(async (
  user,
  { tenant: _tenant },
): Promise<ReadyQueueRow[]> => {
  await assertBillingReadPermission(user);
  const { knex } = await createTenantKnex();
  const rows = await ProjectBillingScheduleEntry.listReadyQueue(knex);
  return rows.map((row) => ({
    ...row,
    entry: {
      ...row.entry,
      phase_deleted: row.entry.phase_deleted
        || (row.entry.trigger_type === 'phase' && row.entry.phase_id === null),
      trigger_type: row.entry.trigger_type === 'phase' && row.entry.phase_id === null
        ? 'manual'
        : row.entry.trigger_type,
    },
  })) as ReadyQueueRow[];
});

export const getReadyEntryCount = withAuth(async (
  user,
  { tenant: _tenant },
): Promise<number> => {
  await assertBillingReadPermission(user);
  const { knex } = await createTenantKnex();
  return (await ProjectBillingScheduleEntry.listReadyQueue(knex)).length;
});
