import type { ProjectBillingScheduleStatus, ScheduleEntryView } from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate } from './dateTimeUtils';

/**
 * Shared project-billing status presentation + phase badge derivation.
 *
 * Lives in core (horizontal) because both billing (schedule UI) and projects
 * (phase badges) render these statuses, and vertical feature packages must not
 * import each other.
 */

/**
 * Visual weight of each schedule status, quiet-and-exact per DESIGN.md: green =
 * money captured, amber = waiting on a person, blue = approved/queued, gray =
 * not yet actionable. Purple is reserved for action/selection, so it is never a
 * status color here.
 */
export interface StatusVisual {
  /** Chip container classes (background + text). */
  chip: string;
  /** Status dot color class. */
  dot: string;
  /** i18n key suffix under `billing.status.*`. */
  labelKey: ProjectBillingScheduleStatus;
}

const STATUS_VISUALS: Record<ProjectBillingScheduleStatus, StatusVisual> = {
  invoiced: {
    chip: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
    dot: 'bg-green-500',
    labelKey: 'invoiced',
  },
  approved: {
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
    dot: 'bg-blue-500',
    labelKey: 'approved',
  },
  ready: {
    chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    dot: 'bg-amber-500',
    labelKey: 'ready',
  },
  held: {
    chip: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300',
    dot: 'bg-orange-500',
    labelKey: 'held',
  },
  pending: {
    chip: 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-300',
    dot: 'bg-gray-400',
    labelKey: 'pending',
  },
  canceled: {
    chip: 'bg-gray-100 text-gray-400 line-through dark:bg-gray-500/10 dark:text-gray-400',
    dot: 'bg-gray-300',
    labelKey: 'canceled',
  },
};

export function statusVisual(status: ProjectBillingScheduleStatus): StatusVisual {
  return STATUS_VISUALS[status] ?? STATUS_VISUALS.pending;
}

/** Advancement order used to pick the "most progressed" status among a phase's entries. */
const STATUS_RANK: Record<ProjectBillingScheduleStatus, number> = {
  canceled: 0,
  pending: 1,
  ready: 2,
  held: 2,
  approved: 3,
  invoiced: 4,
};

export interface PhaseBillingBadge {
  status: ProjectBillingScheduleStatus;
  /** Summed computed amount of the phase's non-canceled linked entries, in cents. */
  amountCents: number;
  currency: string | null;
  /** A past-dated phase still has a pending phase-triggered billing entry. */
  overdue: boolean;
}

function calendarDate(value: Date | string | null): Temporal.PlainDate | null {
  if (!value) return null;
  try {
    return toPlainDate(value);
  } catch {
    return null;
  }
}

export function isPhaseBillingOverdue(
  entry: Pick<ScheduleEntryView, 'phase_end_date' | 'status' | 'trigger_type'>,
  today: string | null,
): boolean {
  const endDate = calendarDate(entry.phase_end_date);
  const currentDate = calendarDate(today);
  return Boolean(
    endDate
    && currentDate
    && entry.trigger_type === 'phase'
    && entry.status === 'pending'
    && Temporal.PlainDate.compare(endDate, currentDate) < 0,
  );
}

/**
 * Reduce a project's schedule entries to one badge per phase (F136): the phase
 * shows the most-progressed status among its linked entries, with the summed
 * amount. Canceled entries and unlinked entries are ignored.
 */
export function derivePhaseBillingBadges(
  entries: ScheduleEntryView[],
  currency: string | null,
  today: string | null = null,
): Record<string, PhaseBillingBadge> {
  const badges: Record<string, PhaseBillingBadge> = {};
  for (const entry of entries) {
    if (!entry.phase_id || entry.status === 'canceled') continue;
    const existing = badges[entry.phase_id];
    if (!existing) {
      badges[entry.phase_id] = {
        status: entry.status,
        amountCents: entry.computed_amount,
        currency,
        overdue: isPhaseBillingOverdue(entry, today),
      };
      continue;
    }
    existing.amountCents += entry.computed_amount;
    existing.overdue ||= isPhaseBillingOverdue(entry, today);
    if (STATUS_RANK[entry.status] > STATUS_RANK[existing.status]) {
      existing.status = entry.status;
    }
  }
  return badges;
}

/** Small $-badge classes for the phases panel, mirroring the status palette. */
export function phaseBadgeClasses(status: ProjectBillingScheduleStatus): string {
  return statusVisual(status).chip;
}
