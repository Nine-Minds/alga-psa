'use server';

import type { z } from 'zod';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IOpportunity, IOpportunityStep, IOpportunityStepTemplate, OpportunityStage } from '@alga-psa/types';
import {
  completeOpportunityStepSchema,
  createOpportunityStepSchema,
  reorderOpportunityStepsSchema,
  saveOpportunityStepTemplatesSchema,
  updateOpportunityNextActionSchema,
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
import { nextPlannedStep, templateDueDate } from '../lib/opportunityStepPlan';
import { OPEN_OPPORTUNITY_STAGES } from '../lib/opportunityStages';
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

/** Replace one stage's template rows inside the caller's transaction. */
async function replaceStageTemplates(
  trx: Parameters<typeof tenantDb>[0],
  tenant: string,
  data: z.output<typeof saveOpportunityStepTemplatesSchema>,
): Promise<void> {
  await tenantDb(trx, tenant).table('opportunity_step_templates').where({ stage: data.stage }).delete();
  for (const [index, entry] of data.titles.entries()) {
    await tenantDb(trx, tenant).table('opportunity_step_templates').insert({
      tenant,
      stage: data.stage,
      title: entry.title,
      sort_order: index,
      due_offset_days: entry.due_offset_days,
    });
  }
}

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
  const data = saveOpportunityStepTemplatesSchema.parse({ stage, titles });
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    await replaceStageTemplates(trx, tenant, data);
    return OpportunityStepModel.listTemplates(trx, tenant, data.stage);
  });
});

/**
 * The whole settings screen in one transaction: every stage's rows are
 * validated first and written together, so a failure part-way leaves nothing
 * committed and the screen never shows a half-saved plan.
 */
export const saveAllOpportunityStepTemplates = withAuth(async (
  user,
  { tenant },
  plans: Array<{ stage: OpportunityStage; titles: Array<{ title: string; due_offset_days: number }> }>,
): Promise<IOpportunityStepTemplate[]> => {
  await requirePermission(user, 'update');
  const parsed = plans.map((plan) => saveOpportunityStepTemplatesSchema.parse(plan));
  const seen = new Set<string>();
  for (const plan of parsed) {
    if (seen.has(plan.stage)) throw new Error(`Duplicate stage in template save: ${plan.stage}`);
    seen.add(plan.stage);
  }
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    for (const data of parsed) {
      await replaceStageTemplates(trx, tenant, data);
    }
    return OpportunityStepModel.listTemplates(trx, tenant);
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
    await OpportunityStepModel.lockForOpportunity(trx, tenant, opportunityId);
    const steps = await ensureCurrentStep(trx, tenant, opportunity, actorId(user));
    const existingCurrent = steps.find((step) => step.status === 'current');
    const wantsCurrent = data.status === 'current' || !existingCurrent;
    // The plan carries one current step: an explicit new current demotes the
    // old one back into the ladder first.
    if (wantsCurrent && existingCurrent) {
      await OpportunityStepModel.update(trx, tenant, existingCurrent.step_id, { status: 'planned' });
    }
    const created = await OpportunityStepModel.create(trx, tenant, {
      opportunity_id: opportunityId,
      title: data.title,
      due_at: data.due_at ?? null,
      has_time: data.has_time ?? false,
      duration_minutes: data.duration_minutes ?? 30,
      assigned_to: data.assigned_to ?? opportunity.owner_id,
      checkpoint: data.checkpoint ?? null,
      // An untagged step belongs to the stage the deal is working through.
      stage: data.stage ?? (opportunity.stage === 'won' || opportunity.stage === 'lost' ? null : opportunity.stage),
      ticket_id: data.ticket_id ?? null,
      project_task_id: data.project_task_id ?? null,
      status: wantsCurrent ? 'current' : 'planned',
      sort_order: await OpportunityStepModel.nextSortOrder(trx, tenant, opportunityId),
      created_by: actorId(user),
    });
    const synced = await syncStepScheduleEntry(trx, tenant, created, opportunity, actorId(user));
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
    await OpportunityStepModel.lockForOpportunity(trx, tenant, existing.opportunity_id);
    const opportunity = await OpportunityModel.getById(trx, tenant, existing.opportunity_id);
    if (!opportunity) throw new Error('Opportunity not found');
    // Becoming current demotes the previous current step first, so the plan
    // never carries two.
    if (data.status === 'current' && existing.status !== 'current') {
      const siblings = await OpportunityStepModel.listForOpportunity(trx, tenant, existing.opportunity_id);
      const current = siblings.find((step) => step.status === 'current' && step.step_id !== stepId);
      if (current) await OpportunityStepModel.update(trx, tenant, current.step_id, { status: 'planned' });
    }
    const updated = await OpportunityStepModel.update(trx, tenant, stepId, {
      ...data,
      // "The deal owner" is a real answer, not an absence: a step always has
      // someone to put it on a calendar for.
      ...(data.assigned_to === null ? { assigned_to: opportunity.owner_id } : {}),
    } as Partial<IOpportunityStep>);
    // Skipping (or demoting) the current step hands the deal to the next
    // planned one, so the ladder never strands.
    if (existing.status === 'current' && data.status && data.status !== 'current') {
      const siblings = await OpportunityStepModel.listForOpportunity(trx, tenant, existing.opportunity_id);
      if (!siblings.some((step) => step.status === 'current')) {
        const candidate = nextPlannedStep(siblings);
        if (candidate) await OpportunityStepModel.update(trx, tenant, candidate.step_id, { status: 'current' });
      }
    }
    const synced = await syncStepScheduleEntry(trx, tenant, updated, opportunity, actorId(user));
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
    await OpportunityStepModel.lockForOpportunity(trx, tenant, existing.opportunity_id);
    const opportunity = await OpportunityModel.getById(trx, tenant, existing.opportunity_id);
    if (opportunity && existing.schedule_entry_id) {
      await syncStepScheduleEntry(trx, tenant, { ...existing, status: 'skipped' }, opportunity, actorId(user));
    }
    const deleted = await OpportunityStepModel.delete(trx, tenant, stepId);
    // Deleting the current step does not strand the plan: the next planned
    // one takes over before the mirror is rewritten.
    if (deleted && existing.status === 'current') {
      const remaining = await OpportunityStepModel.listForOpportunity(trx, tenant, existing.opportunity_id);
      const candidate = nextPlannedStep(remaining);
      if (candidate) await OpportunityStepModel.update(trx, tenant, candidate.step_id, { status: 'current' });
    }
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
  const data = reorderOpportunityStepsSchema.parse({ opportunity_id: opportunityId, ordered_step_ids: orderedStepIds });
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    await OpportunityStepModel.lockForOpportunity(trx, tenant, data.opportunity_id);
    const steps = await OpportunityStepModel.listForOpportunity(trx, tenant, data.opportunity_id);
    const known = new Set(steps.map((step) => step.step_id));
    const seen = new Set<string>();
    for (const id of data.ordered_step_ids) {
      if (!known.has(id)) throw new Error('Cannot reorder a step that is not part of this opportunity');
      if (seen.has(id)) throw new Error('Duplicate step in reorder request');
      seen.add(id);
    }
    // Steps the caller did not mention keep their relative order, after the
    // named ones, so sort_order stays collision-free on partial lists.
    const order = [
      ...data.ordered_step_ids,
      ...steps.filter((step) => !seen.has(step.step_id)).map((step) => step.step_id),
    ];
    for (const [index, stepId] of order.entries()) {
      await tenantDb(trx, tenant).table('opportunity_steps')
        .where({ step_id: stepId, opportunity_id: data.opportunity_id })
        .update({ sort_order: index, updated_at: new Date().toISOString() });
    }
    return OpportunityStepModel.listForOpportunity(trx, tenant, data.opportunity_id);
  });
});

/**
 * Lays out whole stages' worth of work in one click. Pass several stages to
 * plan the rest of the pipeline ahead of time; they are applied in pipeline
 * order so the plan reads the way the deal will actually run. A step whose
 * title is already open for that stage is left alone, so pressing the button
 * twice does not double the plan.
 */
export const applyOpportunityStepTemplate = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  stage: OpportunityStage | OpportunityStage[],
): Promise<IOpportunityStep[]> => {
  await requirePermission(user, 'update');
  const requested = Array.isArray(stage) ? stage : [stage];
  const stages = OPEN_OPPORTUNITY_STAGES.filter((entry) => requested.includes(entry));
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const opportunity = await OpportunityModel.getById(trx, tenant, opportunityId);
    if (!opportunity) throw new Error('Opportunity not found');
    await OpportunityStepModel.lockForOpportunity(trx, tenant, opportunityId);
    const existing = await ensureCurrentStep(trx, tenant, opportunity, actorId(user));
    let sortOrder = await OpportunityStepModel.nextSortOrder(trx, tenant, opportunityId);
    let hasCurrent = existing.some((step) => step.status === 'current');
    const openTitles = new Set(
      existing
        .filter((step) => step.status === 'planned' || step.status === 'current')
        .map((step) => `${step.stage ?? ''}:${step.title.trim().toLowerCase()}`),
    );
    const now = new Date();

    for (const entry of stages) {
      const templates = await OpportunityStepModel.listTemplates(trx, tenant, entry);
      for (const template of templates) {
        const title = template.title.trim().toLowerCase();
        const fingerprint = `${entry}:${title}`;
        // A backfilled step carries no stage; its bare title still marks the
        // same work as already open.
        if (openTitles.has(fingerprint) || openTitles.has(`:${title}`)) continue;
        openTitles.add(fingerprint);
        // Only the stage the deal is actually on may take over as current work.
        const becomesCurrent = !hasCurrent && entry === opportunity.stage;
        await OpportunityStepModel.create(trx, tenant, {
          opportunity_id: opportunityId,
          title: template.title,
          due_at: templateDueDate(now, template.due_offset_days),
          assigned_to: opportunity.owner_id,
          stage: entry as IOpportunityStep['stage'],
          status: becomesCurrent ? 'current' : 'planned',
          sort_order: sortOrder++,
          created_by: actorId(user),
        });
        if (becomesCurrent) hasCurrent = true;
      }
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

/**
 * The legacy "edit the next action" affordances (snooze, the edit dialog)
 * write through the current step, so the mirror columns keep a single writer.
 */
export const updateOpportunityNextAction = withAuth(async (
  user,
  { tenant },
  opportunityId: string,
  input: unknown,
): Promise<IOpportunity> => {
  await requirePermission(user, 'update');
  const data = updateOpportunityNextActionSchema.parse(input);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const opportunity = await OpportunityModel.getById(trx, tenant, opportunityId);
    if (!opportunity) throw new Error('Opportunity not found');
    await OpportunityStepModel.lockForOpportunity(trx, tenant, opportunityId);
    const steps = await ensureCurrentStep(trx, tenant, opportunity, actorId(user));
    const current = steps.find((step) => step.status === 'current');
    if (current) {
      const updated = await OpportunityStepModel.update(trx, tenant, current.step_id, {
        ...(data.next_action !== undefined ? { title: data.next_action } : {}),
        ...(data.next_action_due !== undefined ? { due_at: data.next_action_due } : {}),
      });
      await syncStepScheduleEntry(trx, tenant, updated, opportunity, actorId(user));
    } else if (data.next_action) {
      const created = await OpportunityStepModel.create(trx, tenant, {
        opportunity_id: opportunityId,
        title: data.next_action,
        due_at: data.next_action_due ?? null,
        status: 'current',
        assigned_to: opportunity.owner_id,
        sort_order: await OpportunityStepModel.nextSortOrder(trx, tenant, opportunityId),
        created_by: actorId(user),
      });
      await syncStepScheduleEntry(trx, tenant, created, opportunity, actorId(user));
    } else {
      throw new Error('Opportunity has no current step to reschedule');
    }
    return mirrorCurrentStepOntoOpportunity(trx, tenant, opportunityId, {
      ...(data.next_action_due !== undefined ? { overdue_notified_at: null } : {}),
    } as Partial<IOpportunity>);
  });
});

/**
 * Carries the fields UserPicker reads (name parts, type, tenant, avatar key)
 * alongside the display name the plain lists use.
 */
export interface OpportunityStepAssignee {
  user_id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  user_type: string;
  is_inactive: boolean;
  tenant: string;
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
    first_name: String(row.first_name ?? ''),
    last_name: String(row.last_name ?? ''),
    email: String(row.email ?? ''),
    user_type: 'internal',
    is_inactive: false,
    tenant,
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
