/**
 * SLA clock state for the Grid layout's "SLA clocks" tile and hero slab.
 * Reads the sla_* columns already present on the consolidated ticket payload.
 * Copy follows the house-voice table in
 * docs/plans/2026-07-03-ticket-bento-story-layout/PRD.md.
 */

export interface TicketSlaFields {
  sla_policy_id?: string | null;
  sla_started_at?: string | Date | null;
  sla_response_due_at?: string | Date | null;
  sla_response_at?: string | Date | null;
  sla_response_met?: boolean | null;
  sla_resolution_due_at?: string | Date | null;
  sla_resolution_at?: string | Date | null;
  sla_resolution_met?: boolean | null;
  sla_paused_at?: string | Date | null;
}

export type SlaClockState = 'none' | 'met' | 'missed' | 'running' | 'overdue' | 'paused';

export interface SlaClock {
  state: SlaClockState;
  /** House-voice label, e.g. "Met in 42m", "4h 12m left", "Overdue by 2h", "Paused". */
  label: string;
  /** 0..100 share of the window already elapsed; null when not meaningful. */
  pctElapsed: number | null;
}

export interface SlaClocks {
  policyApplied: boolean;
  response: SlaClock;
  resolution: SlaClock;
}

function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function formatDurationShort(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function computeClock(
  startedAt: number | null,
  dueAt: number | null,
  completedAt: number | null,
  met: boolean | null | undefined,
  pausedAt: number | null,
  now: number,
): SlaClock {
  if (dueAt == null) return { state: 'none', label: 'No target', pctElapsed: null };

  if (completedAt != null || met != null) {
    const wasMet = met ?? (completedAt != null && completedAt <= dueAt);
    if (wasMet) {
      const took = completedAt != null && startedAt != null ? completedAt - startedAt : null;
      return {
        state: 'met',
        label: took != null ? `Met in ${formatDurationShort(took)}` : 'Met',
        pctElapsed: 100,
      };
    }
    const by = completedAt != null ? completedAt - dueAt : null;
    return {
      state: 'missed',
      label: by != null && by > 0 ? `Missed by ${formatDurationShort(by)}` : 'Missed',
      pctElapsed: 100,
    };
  }

  if (pausedAt != null) {
    return { state: 'paused', label: 'Paused', pctElapsed: pct(startedAt, dueAt, pausedAt) };
  }

  if (now > dueAt) {
    return {
      state: 'overdue',
      label: `Overdue by ${formatDurationShort(now - dueAt)}`,
      pctElapsed: 100,
    };
  }

  return {
    state: 'running',
    label: `${formatDurationShort(dueAt - now)} left`,
    pctElapsed: pct(startedAt, dueAt, now),
  };
}

function pct(startedAt: number | null, dueAt: number, at: number): number | null {
  if (startedAt == null || dueAt <= startedAt) return null;
  const raw = ((at - startedAt) / (dueAt - startedAt)) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export function computeSlaClocks(ticket: TicketSlaFields, now: number = Date.now()): SlaClocks {
  const startedAt = toMs(ticket.sla_started_at);
  const pausedAt = toMs(ticket.sla_paused_at);
  const responseDue = toMs(ticket.sla_response_due_at);
  const resolutionDue = toMs(ticket.sla_resolution_due_at);

  const policyApplied = Boolean(ticket.sla_policy_id) && (responseDue != null || resolutionDue != null);

  return {
    policyApplied,
    response: computeClock(
      startedAt,
      responseDue,
      toMs(ticket.sla_response_at),
      ticket.sla_response_met,
      pausedAt,
      now,
    ),
    resolution: computeClock(
      startedAt,
      resolutionDue,
      toMs(ticket.sla_resolution_at),
      ticket.sla_resolution_met,
      pausedAt,
      now,
    ),
  };
}
