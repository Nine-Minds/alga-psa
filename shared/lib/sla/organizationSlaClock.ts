import { segmentSpanByBusinessHours, type BusinessHoursScheduleInput } from '../businessHours/businessHoursSegmentation';

/** Policy-owning organization and canonical source are deliberately separate.
 * A reopened obligation receives a new obligationId; a handback never does. */
export interface OrganizationSlaIdentity {
  tenant: string;
  obligationId: string;
  sourceTenant: string;
  ticketId: string;
}
export interface OrganizationSlaClock {
  identity: OrganizationSlaIdentity;
  schedule: BusinessHoursScheduleInput;
  startedAt: string;
  observedAt: string;
  elapsedMilliseconds: number;
  pauseReasons: string[];
  response: OrganizationSlaTargetClock;
  resolution: OrganizationSlaTargetClock;
}
export interface OrganizationSlaTargetClock {
  targetMinutes: number | null;
  dueAt: string | null;
  completedAt: string | null;
  completedElapsedMilliseconds: number | null;
  breached: boolean;
  breachedAt: string | null;
}

function instant(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid SLA observation time');
  return date;
}
function target(minutes: number | null | undefined): OrganizationSlaTargetClock {
  if (minutes != null && (!Number.isFinite(minutes) || minutes < 0)) throw new Error('Invalid SLA target');
  return { targetMinutes: minutes ?? null, dueAt: null, completedAt: null, completedElapsedMilliseconds: null, breached: false, breachedAt: null };
}

/** Millisecond precision matters: repeated short handoffs must not discard the
 * fractional minutes that the customer has already spent with the MSP. */
function businessMilliseconds(schedule: BusinessHoursScheduleInput, start: Date, end: Date): number {
  return segmentSpanByBusinessHours(schedule, start, end).reduce((total, segment) =>
    total + (segment.isBusinessHours ? segment.end.getTime() - segment.start.getTime() : 0), 0);
}

/** Consume the existing calendar segments, including holidays and DST. This
 * does not implement another wall-clock classification or round partial minutes.
 * An impossible calendar fails setup instead of fabricating a deadline. */
export function organizationSlaDeadline(schedule: BusinessHoursScheduleInput, at: Date, remainingMilliseconds: number): Date {
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(remainingMilliseconds)) throw new Error('Invalid SLA deadline input');
  if (remainingMilliseconds <= 0) return new Date(at);
  if (schedule.is_24x7) return new Date(at.getTime() + remainingMilliseconds);
  let start = new Date(at), remaining = remainingMilliseconds;
  // Search a bounded year in weekly spans; segmentation owns time-zone rules.
  for (let day = 0; day < 366; day += 7) {
    const end = new Date(start.getTime() + Math.min(7, 366 - day) * 86400000);
    for (const segment of segmentSpanByBusinessHours(schedule, start, end)) {
      if (!segment.isBusinessHours) continue;
      const duration = segment.end.getTime() - segment.start.getTime();
      if (duration >= remaining) return new Date(segment.start.getTime() + remaining);
      remaining -= duration;
    }
    start = end;
  }
  throw new Error('SLA target cannot be scheduled within one year');
}

function updateDeadlines(clock: OrganizationSlaClock, at: Date): void {
  for (const timer of [clock.response, clock.resolution]) {
    if (timer.targetMinutes === null || timer.completedAt) continue;
    if (clock.elapsedMilliseconds > timer.targetMinutes * 60000 && !timer.breached) {
      timer.breached = true;
      timer.breachedAt = timer.dueAt ?? at.toISOString();
    }
    if (clock.pauseReasons.length || clock.resolution.completedAt) {
      timer.dueAt = null;
    } else {
      // Preserve the original breach deadline while running. A resumed breached
      // obligation remains breached even though it no longer has time remaining.
      timer.dueAt ??= organizationSlaDeadline(clock.schedule, at,
        timer.targetMinutes * 60000 - clock.elapsedMilliseconds).toISOString();
    }
  }
}

export function startOrganizationSlaClock(identity: OrganizationSlaIdentity, schedule: BusinessHoursScheduleInput,
  targets: { responseMinutes?: number | null; resolutionMinutes?: number | null }, occurredAt: string): OrganizationSlaClock {
  const at = instant(occurredAt);
  // Snapshot the resolved MSP policy/calendar. Subsequent configuration changes
  // require their own explicit policy-change command, not incidental handoffs.
  const clock: OrganizationSlaClock = { identity: structuredClone(identity), schedule: structuredClone(schedule),
    startedAt: at.toISOString(), observedAt: at.toISOString(), elapsedMilliseconds: 0, pauseReasons: [],
    response: target(targets.responseMinutes), resolution: target(targets.resolutionMinutes) };
  updateDeadlines(clock, at);
  return clock;
}

/** Pure reducer; persistence must serialize by the organization obligation and
 * deduplicate the actual domain event before applying it. */
export function observeOrganizationSlaClock(input: OrganizationSlaClock, occurredAt: string): OrganizationSlaClock {
  const clock = structuredClone(input), at = instant(occurredAt), previous = instant(clock.observedAt);
  if (at < previous) throw new Error('SLA events must be applied in causal order');
  if (!clock.pauseReasons.length && !clock.resolution.completedAt) {
    clock.elapsedMilliseconds += businessMilliseconds(clock.schedule, previous, at);
  }
  clock.observedAt = at.toISOString();
  updateDeadlines(clock, at);
  return clock;
}

export function pauseOrganizationSlaClock(input: OrganizationSlaClock, reason: string, occurredAt: string): OrganizationSlaClock {
  if (!reason.trim()) throw new Error('An SLA pause requires a reason');
  const clock = observeOrganizationSlaClock(input, occurredAt);
  if (!clock.resolution.completedAt && !clock.pauseReasons.includes(reason)) clock.pauseReasons.push(reason);
  updateDeadlines(clock, instant(occurredAt));
  return clock;
}

export function resumeOrganizationSlaClock(input: OrganizationSlaClock, reason: string, occurredAt: string): OrganizationSlaClock {
  const clock = observeOrganizationSlaClock(input, occurredAt);
  clock.pauseReasons = clock.pauseReasons.filter(value => value !== reason);
  updateDeadlines(clock, instant(occurredAt));
  return clock;
}

export function respondToOrganizationSlaClock(input: OrganizationSlaClock,
  response: { actorTenant: string; audience: 'requester' | 'shared_it' | 'organization_private' }, occurredAt: string): OrganizationSlaClock {
  const clock = observeOrganizationSlaClock(input, occurredAt);
  if (clock.resolution.completedAt || clock.response.completedAt || response.actorTenant !== clock.identity.tenant ||
      !['requester', 'shared_it'].includes(response.audience)) return clock;
  clock.response.completedAt = instant(occurredAt).toISOString();
  clock.response.completedElapsedMilliseconds = clock.elapsedMilliseconds;
  return clock;
}

export function resolveOrganizationSlaClock(input: OrganizationSlaClock, occurredAt: string): OrganizationSlaClock {
  const clock = observeOrganizationSlaClock(input, occurredAt);
  if (!clock.resolution.completedAt) {
    clock.resolution.completedAt = instant(occurredAt).toISOString();
    clock.resolution.completedElapsedMilliseconds = clock.elapsedMilliseconds;
    // Resolution closes the timer but does not invent an MSP first response.
    if (!clock.response.completedAt) clock.response.dueAt = null;
  }
  return clock;
}

// ---------------------------------------------------------------------------
// Transition application: the single entry point the store and handlers use.
// ---------------------------------------------------------------------------

/** Pause reason used while the work sits with the customer organization. */
export const CUSTOMER_RESPONSIBLE_PAUSE = 'customer_responsible';
/** Pause reason used while the ticket is waiting on the requester. */
export const AWAITING_REQUESTER_PAUSE = 'awaiting_requester';

export type OrganizationSlaTransition =
  | { kind: 'observe' }
  | { kind: 'pause'; reason: string }
  | { kind: 'resume'; reason: string }
  | { kind: 'respond'; actorTenant: string; audience: 'requester' | 'shared_it' | 'organization_private' }
  | { kind: 'resolve' };

export type OrganizationSlaState = 'running' | 'paused' | 'met' | 'breached';

/** Apply one transition to a stored clock. Pure: the caller injects `now`. */
export function applyOrganizationSlaTransition(clock: OrganizationSlaClock, transition: OrganizationSlaTransition,
  now: string): OrganizationSlaClock {
  switch (transition.kind) {
    case 'observe': return observeOrganizationSlaClock(clock, now);
    case 'pause': return pauseOrganizationSlaClock(clock, transition.reason, now);
    case 'resume': return resumeOrganizationSlaClock(clock, transition.reason, now);
    case 'respond': return respondToOrganizationSlaClock(clock, transition, now);
    case 'resolve': return resolveOrganizationSlaClock(clock, now);
  }
}

/** Derive state from a clock: resolved → met/breached, else paused/running (breach wins while open). */
export function organizationSlaState(clock: OrganizationSlaClock): OrganizationSlaState {
  const timers = [clock.response, clock.resolution];
  if (clock.resolution.completedAt) return timers.some(timer => timer.breached) ? 'breached' : 'met';
  if (timers.some(timer => timer.breached)) return 'breached';
  return clock.pauseReasons.length ? 'paused' : 'running';
}

/** Accumulated business-hours elapsed minutes (fractional). */
export function organizationSlaElapsedMinutes(clock: OrganizationSlaClock): number {
  return clock.elapsedMilliseconds / 60000;
}
