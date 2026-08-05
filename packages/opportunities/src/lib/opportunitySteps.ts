import type { Knex } from 'knex';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { registerAfterCommit } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { IEditScope, type IOpportunity, type IOpportunityStep, type IScheduleEntry } from '@alga-psa/types';
import { OpportunityModel } from '../models/opportunityModel';
import { OpportunityStepModel } from '../models/opportunityStepModel';
import { recordCompletedActionInteraction } from './completedActionInteraction';
import { currentStep, mirrorOfCurrentStep, nextPlannedStep, scheduleWindow } from './opportunityStepPlan';

/**
 * Same shape the scheduling domain puts on the bus (see scheduleActions.ts),
 * so the calendar-sync, search-indexer, and notification subscribers cannot
 * tell a step-written entry from a hand-written one.
 */
function sanitizeScheduleEntryForEvent(entry: IScheduleEntry | null | undefined) {
  if (!entry) return undefined;

  const toIsoString = (value: unknown): string | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  return {
    id: entry.entry_id,
    title: entry.title,
    scheduledStart: toIsoString(entry.scheduled_start),
    scheduledEnd: toIsoString(entry.scheduled_end),
    status: entry.status,
    workItemId: entry.work_item_id,
    workItemType: entry.work_item_type,
    isRecurring: entry.is_recurring,
    recurrencePattern: entry.recurrence_pattern,
    assignedUserIds: entry.assigned_user_ids ?? [],
    isPrivate: entry.is_private,
  };
}

/**
 * The scheduling domain publishes SCHEDULE_ENTRY_* only after its transaction
 * committed; writing entries from inside the step transaction therefore queues
 * the event on the commit hook instead of publishing it mid-flight.
 */
function publishScheduleEntryEventAfterCommit(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string,
  eventType: 'SCHEDULE_ENTRY_CREATED' | 'SCHEDULE_ENTRY_UPDATED' | 'SCHEDULE_ENTRY_DELETED',
  entryId: string,
  changes: Record<string, unknown>,
): void {
  registerAfterCommit(trx, () => publishEvent({
    eventType,
    payload: {
      tenantId: tenant,
      userId: actorUserId,
      entryId,
      changes,
    },
  }), `${eventType} entry=${entryId}`);
}

/**
 * Keeps opportunities.next_action / next_action_due equal to the current step.
 * The columns stay the single source the queue and the discipline jobs read.
 */
export async function mirrorCurrentStepOntoOpportunity(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  extraPatch: Partial<IOpportunity> = {},
): Promise<IOpportunity> {
  const steps = await OpportunityStepModel.listForOpportunity(trx, tenant, opportunityId);
  return OpportunityModel.update(trx, tenant, opportunityId, {
    ...mirrorOfCurrentStep(currentStep(steps)),
    ...extraPatch,
  } as Partial<IOpportunity>);
}

/**
 * A step that has a time and an assignee belongs on that person's calendar;
 * one that loses either belongs nowhere, so the entry is removed again.
 */
export async function syncStepScheduleEntry(
  trx: Knex.Transaction,
  tenant: string,
  step: IOpportunityStep,
  opportunity: Pick<IOpportunity, 'opportunity_id' | 'title'>,
  actorUserId: string,
): Promise<IOpportunityStep> {
  const shouldSchedule = Boolean(step.has_time && step.due_at && step.assigned_to && step.status !== 'done' && step.status !== 'skipped');

  if (!shouldSchedule) {
    if (!step.schedule_entry_id) return step;
    const before = await ScheduleEntry.get(trx, tenant, step.schedule_entry_id);
    await ScheduleEntry.delete(trx, tenant, step.schedule_entry_id);
    if (before) {
      publishScheduleEntryEventAfterCommit(trx, tenant, actorUserId, 'SCHEDULE_ENTRY_DELETED', before.entry_id, {
        before: sanitizeScheduleEntryForEvent(before),
        deleteType: IEditScope.SINGLE,
      });
    }
    return OpportunityStepModel.update(trx, tenant, step.step_id, { schedule_entry_id: null });
  }

  const { start, end } = scheduleWindow(step.due_at as string, step.duration_minutes);
  const title = `${opportunity.title}: ${step.title}`;

  if (step.schedule_entry_id) {
    const before = await ScheduleEntry.get(trx, tenant, step.schedule_entry_id);
    const updated = await ScheduleEntry.update(trx, tenant, step.schedule_entry_id, {
      title,
      scheduled_start: start as never,
      scheduled_end: end as never,
      assigned_user_ids: [step.assigned_to as string],
    });
    if (updated) {
      publishScheduleEntryEventAfterCommit(trx, tenant, actorUserId, 'SCHEDULE_ENTRY_UPDATED', updated.entry_id, {
        before: sanitizeScheduleEntryForEvent(before),
        after: sanitizeScheduleEntryForEvent(updated),
        updateType: IEditScope.SINGLE,
      });
      return step;
    }
  }

  const created = await ScheduleEntry.create(
    trx,
    tenant,
    {
      title,
      scheduled_start: start as never,
      scheduled_end: end as never,
      status: 'scheduled',
      work_item_id: step.step_id,
      work_item_type: 'opportunity_step',
      notes: null as never,
    } as never,
    { assignedUserIds: [step.assigned_to as string] },
  );
  publishScheduleEntryEventAfterCommit(trx, tenant, actorUserId, 'SCHEDULE_ENTRY_CREATED', created.entry_id, {
    after: sanitizeScheduleEntryForEvent(created),
    assignedUserIds: [step.assigned_to as string],
  });
  return OpportunityStepModel.update(trx, tenant, step.step_id, { schedule_entry_id: created.entry_id });
}

/**
 * Sweeps every calendar entry the plan owns: the entries are deleted, the
 * steps' pointers cleared, and a SCHEDULE_ENTRY_DELETED queued per entry.
 * Closing a deal keeps its steps as plan history but takes them off calendars;
 * deleting a deal calls this before the steps themselves cascade away.
 */
export async function removeOpportunityStepScheduleEntries(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  actorUserId: string,
): Promise<void> {
  await OpportunityStepModel.lockForOpportunity(trx, tenant, opportunityId);
  const steps = await OpportunityStepModel.listForOpportunity(trx, tenant, opportunityId);
  for (const step of steps) {
    if (!step.schedule_entry_id) continue;
    const before = await ScheduleEntry.get(trx, tenant, step.schedule_entry_id);
    await ScheduleEntry.delete(trx, tenant, step.schedule_entry_id);
    await OpportunityStepModel.update(trx, tenant, step.step_id, { schedule_entry_id: null });
    if (before) {
      publishScheduleEntryEventAfterCommit(trx, tenant, actorUserId, 'SCHEDULE_ENTRY_DELETED', before.entry_id, {
        before: sanitizeScheduleEntryForEvent(before),
        deleteType: IEditScope.SINGLE,
      });
    }
  }
}

/**
 * Deals created before the step plan (or through a path that only wrote the
 * mirror columns) get their current step materialized on first use.
 */
export async function ensureCurrentStep(
  trx: Knex.Transaction,
  tenant: string,
  opportunity: IOpportunity,
  actorUserId: string,
): Promise<IOpportunityStep[]> {
  const steps = await OpportunityStepModel.listForOpportunity(trx, tenant, opportunity.opportunity_id);
  if (currentStep(steps)) return steps;

  // A stranded plan — planned steps but no current one — heals from its own
  // ladder even when the mirror columns are empty.
  const promotable = nextPlannedStep(steps);
  if (promotable) {
    await OpportunityStepModel.update(trx, tenant, promotable.step_id, { status: 'current' });
  } else if (opportunity.next_action) {
    await OpportunityStepModel.create(trx, tenant, {
      opportunity_id: opportunity.opportunity_id,
      title: opportunity.next_action,
      due_at: opportunity.next_action_due ?? null,
      status: 'current',
      assigned_to: opportunity.owner_id,
      sort_order: await OpportunityStepModel.nextSortOrder(trx, tenant, opportunity.opportunity_id),
      created_by: actorUserId,
    });
  } else {
    return steps;
  }
  return OpportunityStepModel.listForOpportunity(trx, tenant, opportunity.opportunity_id);
}

export interface CompleteStepOptions {
  /** Promote an already-planned step instead of inventing a new one. */
  next_step_id?: string | null;
  /** Or write a fresh next step in the same breath. */
  next_action?: string | null;
  next_action_due?: string | null;
  /** The user attesting that finishing this step also reached a checkpoint. */
  checkpoint?: IOpportunityStep['checkpoint'];
}

export interface CompleteStepResult {
  opportunity: IOpportunity;
  completed: IOpportunityStep;
  promoted?: IOpportunityStep;
  checkpoint?: IOpportunityStep['checkpoint'];
}

/**
 * Finishing a step logs the interaction, promotes the next planned step (or the
 * one just written), and re-mirrors the opportunity. The chain never breaks
 * while a deal is open.
 */
export async function completeOpportunityStepCore(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  stepId: string | null,
  actorUserId: string,
  options: CompleteStepOptions = {},
): Promise<CompleteStepResult> {
  const opportunity = await OpportunityModel.getById(trx, tenant, opportunityId);
  if (!opportunity) throw new Error('Opportunity not found');
  if (opportunity.status !== 'open') throw new Error('Only open opportunities have steps');

  await OpportunityStepModel.lockForOpportunity(trx, tenant, opportunityId);

  const steps = await ensureCurrentStep(trx, tenant, opportunity, actorUserId);
  const target = stepId ? steps.find((step) => step.step_id === stepId) : currentStep(steps);
  if (!target) throw new Error('Opportunity has no current step to complete');
  if (target.status === 'done') throw new Error('Step is already done');

  const wasCurrent = target.status === 'current';
  const otherCurrent = steps.find((step) => step.status === 'current' && step.step_id !== target.step_id);

  // A caller-chosen successor must be a planned step of this very plan.
  let nextStep: IOpportunityStep | undefined;
  if (options.next_step_id) {
    nextStep = steps.find((step) => step.step_id === options.next_step_id);
    if (!nextStep || nextStep.step_id === target.step_id || nextStep.status !== 'planned') {
      throw new Error('Next step must be a planned step of this opportunity');
    }
  }

  const now = new Date().toISOString();
  const interactionId = await recordCompletedActionInteraction(trx, tenant, {
    opportunity,
    completedAction: target.title,
    actorUserId,
    occurredAt: now,
  });

  // Conditional on not-done, so a lost race surfaces as the familiar error
  // instead of a second completion.
  const completed = await OpportunityStepModel.markDone(trx, tenant, target.step_id, {
    completed_at: now,
    completed_by: actorUserId,
    interaction_id: interactionId,
  });
  if (!completed) throw new Error('Step is already done');
  await syncStepScheduleEntry(trx, tenant, completed, opportunity, actorUserId);

  // Exactly one current step leaves this transaction: demote before promoting
  // so the single-current index never trips, and only fall back to the next
  // planned step when the completed one actually was the current step.
  let promoted: IOpportunityStep | undefined;
  if (nextStep) {
    if (otherCurrent) await OpportunityStepModel.update(trx, tenant, otherCurrent.step_id, { status: 'planned' });
    promoted = await OpportunityStepModel.update(trx, tenant, nextStep.step_id, { status: 'current' });
  } else if (options.next_action) {
    if (otherCurrent) await OpportunityStepModel.update(trx, tenant, otherCurrent.step_id, { status: 'planned' });
    promoted = await OpportunityStepModel.create(trx, tenant, {
      opportunity_id: opportunityId,
      title: options.next_action,
      due_at: options.next_action_due ?? null,
      status: 'current',
      assigned_to: target.assigned_to ?? opportunity.owner_id,
      sort_order: await OpportunityStepModel.nextSortOrder(trx, tenant, opportunityId),
      created_by: actorUserId,
    });
  } else if (wasCurrent) {
    const candidate = nextPlannedStep(steps, target.step_id);
    if (candidate) {
      promoted = await OpportunityStepModel.update(trx, tenant, candidate.step_id, { status: 'current' });
    }
  }

  const updated = await mirrorCurrentStepOntoOpportunity(trx, tenant, opportunityId, {
    last_activity_at: now,
    overdue_notified_at: null,
  } as Partial<IOpportunity>);

  return {
    opportunity: updated,
    completed,
    promoted,
    checkpoint: options.checkpoint ?? target.checkpoint ?? null,
  };
}

/**
 * The single-next-action entry point kept for the API and the queue: the
 * current step is completed and the caller's replacement becomes current.
 */
export async function completeOpportunityNextAction(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  nextAction: { next_action: string; next_action_due: string; next_step_id?: string | null },
  actorUserId: string,
): Promise<IOpportunity> {
  const result = await completeOpportunityStepCore(trx, tenant, opportunityId, null, actorUserId, {
    next_step_id: nextAction.next_step_id ?? null,
    next_action: nextAction.next_step_id ? null : nextAction.next_action,
    next_action_due: nextAction.next_action_due,
  });
  return result.opportunity;
}
