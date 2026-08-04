'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IOpportunityStep, IOpportunityStepTemplate, OpportunityStage } from '@alga-psa/types';
import {
  completeOpportunityStepSchema,
  createOpportunityStepSchema,
  updateOpportunityStepSchema,
} from '../schemas/opportunitySchemas';
import { OpportunityModel } from '../models/opportunityModel';
import { OpportunityStepModel } from '../models/opportunityStepModel';
import {
  completeOpportunityStepCore,
  ensureCurrentStep,
  mirrorCurrentStepOntoOpportunity,
  syncStepScheduleEntry,
} from '../lib/opportunitySteps';
import { templateDueDate } from '../lib/opportunityStepPlan';
import { declareStage } from '../lib/stageEngine';

async function requirePermission(user: unknown, action: 'read' | 'update'): Promise<void> {
  if (!await hasPermission(user as any, 'opportunities', action)) {
    throw new Error(`Permission denied: opportunities ${action} required`);
  }
}

function actorId(user: any): string {
  const id = user?.user_id;
  if (!id) throw new Error('user is not logged in');
  return id;
}

/** The whole plan: done, current, and the greyed-out future. */
export const listOpportunitySteps = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
): Promise<IOpportunityStep[]> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  return OpportunityStepModel.listForOpportunity(knex, tenant, opportunityId);
});

export const listOpportunityStepTemplates = withAuth(async (
  user,
  { tenant },
  stage?: OpportunityStage,
): Promise<IOpportunityStepTemplate[]> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  return OpportunityStepModel.listTemplates(knex, tenant, stage);
});

/**
 * Settings-side template editing. Tenants that never touch these keep the
 * stock lists; the moment they save one, theirs is what gets applied.
 */
export const saveOpportunityStepTemplates = withAuth(async (
  user,
  { tenant },
  stage: OpportunityStage,
  titles: Array<{ title: string; due_offset_days: number }>,
): Promise<IOpportunityStepTemplate[]> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    await tenantDb(trx, tenant).table('opportunity_step_templates').where({ stage }).delete();
    for (const [index, entry] of titles.entries()) {
      const title = entry.title.trim();
      if (!title) continue;
      await tenantDb(trx, tenant).table('opportunity_step_templates').insert({
        tenant,
        stage,
        title,
        sort_order: index,
        due_offset_days: Math.max(0, Math.round(entry.due_offset_days)),
      });
    }
    return OpportunityStepModel.listTemplates(trx, tenant, stage);
  });
});

export const createOpportunityStep = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  input: unknown,
): Promise<IOpportunityStep> => {
  await requirePermission(user, 'update');
  const data = createOpportunityStepSchema.parse(input);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const opportunity = await OpportunityModel.getById(trx, tenant, opportunityId);
    if (!opportunity) throw new Error('Opportunity not found');
    const steps = await ensureCurrentStep(trx, tenant, opportunity, actorId(user));
    const wantsCurrent = data.status === 'current' || steps.every((step) => step.status !== 'current');
    const created = await OpportunityStepModel.create(trx, tenant, {
      opportunity_id: opportunityId,
      title: data.title,
      due_at: data.due_at ?? null,
      has_time: data.has_time ?? false,
      duration_minutes: data.duration_minutes ?? 30,
      assigned_to: data.assigned_to ?? opportunity.owner_id,
      checkpoint: data.checkpoint ?? null,
      ticket_id: data.ticket_id ?? null,
      project_task_id: data.project_task_id ?? null,
      status: wantsCurrent ? 'current' : 'planned',
      sort_order: await OpportunityStepModel.nextSortOrder(trx, tenant, opportunityId),
      created_by: actorId(user),
    });
    const synced = await syncStepScheduleEntry(trx, tenant, created, opportunity);
    await mirrorCurrentStepOntoOpportunity(trx, tenant, opportunityId);
    return synced;
  });
});

export const updateOpportunityStep = withAuth(async (
  user,
  { tenant },
  stepId: string,
  input: unknown,
): Promise<IOpportunityStep> => {
  await requirePermission(user, 'update');
  const data = updateOpportunityStepSchema.parse(input);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const existing = await OpportunityStepModel.getById(trx, tenant, stepId);
    if (!existing) throw new Error('Step not found');
    const opportunity = await OpportunityModel.getById(trx, tenant, existing.opportunity_id);
    if (!opportunity) throw new Error('Opportunity not found');
    const updated = await OpportunityStepModel.update(trx, tenant, stepId, {
      ...data,
      // "The deal owner" is a real answer, not an absence: a step always has
      // someone to put it on a calendar for.
      ...(data.assigned_to === null ? { assigned_to: opportunity.owner_id } : {}),
    } as Partial<IOpportunityStep>);
    const synced = await syncStepScheduleEntry(trx, tenant, updated, opportunity);
    await mirrorCurrentStepOntoOpportunity(trx, tenant, existing.opportunity_id);
    return synced;
  });
});

export const deleteOpportunityStep = withAuth(async (
  user,
  { tenant },
  stepId: string,
): Promise<boolean> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const existing = await OpportunityStepModel.getById(trx, tenant, stepId);
    if (!existing) return false;
    const opportunity = await OpportunityModel.getById(trx, tenant, existing.opportunity_id);
    if (opportunity && existing.schedule_entry_id) {
      await syncStepScheduleEntry(trx, tenant, { ...existing, status: 'skipped' }, opportunity);
    }
    const deleted = await OpportunityStepModel.delete(trx, tenant, stepId);
    if (deleted) await mirrorCurrentStepOntoOpportunity(trx, tenant, existing.opportunity_id);
    return deleted;
  });
});

/** Drag order is the plan's order; the next planned step is simply the first one. */
export const reorderOpportunitySteps = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  orderedStepIds: string[],
): Promise<IOpportunityStep[]> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    for (const [index, stepId] of orderedStepIds.entries()) {
      await tenantDb(trx, tenant).table('opportunity_steps')
        .where({ step_id: stepId, opportunity_id: opportunityId })
        .update({ sort_order: index, updated_at: new Date().toISOString() });
    }
    return OpportunityStepModel.listForOpportunity(trx, tenant, opportunityId);
  });
});

/** Lays out a whole stage's worth of work in one click. */
export const applyOpportunityStepTemplate = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  stage: OpportunityStage,
): Promise<IOpportunityStep[]> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const opportunity = await OpportunityModel.getById(trx, tenant, opportunityId);
    if (!opportunity) throw new Error('Opportunity not found');
    const templates = await OpportunityStepModel.listTemplates(trx, tenant, stage);
    const existing = await ensureCurrentStep(trx, tenant, opportunity, actorId(user));
    let sortOrder = await OpportunityStepModel.nextSortOrder(trx, tenant, opportunityId);
    const hasCurrent = existing.some((step) => step.status === 'current');
    const now = new Date();
    for (const [index, template] of templates.entries()) {
      await OpportunityStepModel.create(trx, tenant, {
        opportunity_id: opportunityId,
        title: template.title,
        due_at: templateDueDate(now, template.due_offset_days),
        assigned_to: opportunity.owner_id,
        status: !hasCurrent && index === 0 ? 'current' : 'planned',
        sort_order: sortOrder++,
        created_by: actorId(user),
      });
    }
    await mirrorCurrentStepOntoOpportunity(trx, tenant, opportunityId);
    return OpportunityStepModel.listForOpportunity(trx, tenant, opportunityId);
  });
});

/**
 * Done → next, on the plan: the step is completed, the next planned step (or a
 * freshly written one) becomes current, and an attested checkpoint moves the
 * stage in the same breath.
 */
export const completeOpportunityStep = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  stepId: string | null,
  input: unknown,
): Promise<IOpportunityStep[]> => {
  await requirePermission(user, 'update');
  const data = completeOpportunityStepSchema.parse(input ?? {});
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const result = await completeOpportunityStepCore(trx, tenant, opportunityId, stepId, actorId(user), data);
    if (data.checkpoint && data.checkpoint !== 'won') {
      await declareStage(trx, tenant, opportunityId, data.checkpoint, actorId(user), result.completed.title);
    }
    return OpportunityStepModel.listForOpportunity(trx, tenant, opportunityId);
  });
});

export interface OpportunityStepAssignee {
  user_id: string;
  name: string;
}

/** Internal users a step (or the deal) can be handed to. */
export const listOpportunityAssignees = withAuth(async (
  user,
  { tenant },
): Promise<OpportunityStepAssignee[]> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  const rows = await tenantDb(knex, tenant).table('users')
    .where({ user_type: 'internal', is_inactive: false })
    .orderBy([{ column: 'first_name', order: 'asc' }, { column: 'last_name', order: 'asc' }])
    .select('user_id', 'first_name', 'last_name', 'email');
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    user_id: String(row.user_id),
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.email ?? row.user_id),
  }));
});

export interface OpportunityLinkableWorkItem {
  id: string;
  label: string;
}

/** Open tickets for the deal's client, so a step can point at real work. */
export const listLinkableTicketsForOpportunity = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
): Promise<OpportunityLinkableWorkItem[]> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const opportunity = await OpportunityModel.getById(knex, tenant, opportunityId);
  if (!opportunity) return [];
  const rows = await db.table('tickets')
    .where({ client_id: opportunity.client_id })
    .whereNull('closed_at')
    .orderBy('entered_at', 'desc')
    .limit(50)
    .select('ticket_id', 'ticket_number', 'title');
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.ticket_id),
    label: `${row.ticket_number} · ${row.title}`,
  }));
});

/** Project tasks on the client's projects. */
export const listLinkableProjectTasksForOpportunity = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
): Promise<OpportunityLinkableWorkItem[]> => {
  await requirePermission(user, 'read');
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const opportunity = await OpportunityModel.getById(knex, tenant, opportunityId);
  if (!opportunity) return [];
  const query = db.table('project_tasks as t');
  db.tenantJoin(query, 'project_phases as ph', 't.phase_id', 'ph.phase_id');
  db.tenantJoin(query, 'projects as p', 'ph.project_id', 'p.project_id');
  const rows = await query
    .where('p.client_id', opportunity.client_id)
    .orderBy('t.updated_at', 'desc')
    .limit(50)
    .select('t.task_id', 't.task_name', 'p.project_name');
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.task_id),
    label: `${row.project_name} · ${row.task_name}`,
  }));
});

/** Whole-deal ownership; individual steps carry their own assignee. */
export const assignOpportunityOwner = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  ownerId: string,
): Promise<void> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  await withTransaction(knex, (trx) => OpportunityModel.update(trx, tenant, opportunityId, { owner_id: ownerId }));
});
