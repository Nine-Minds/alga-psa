import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type {
  ProjectBillingScheduleStatus,
} from '@alga-psa/types';
import type { ScheduleEntryView } from '@alga-psa/billing/actions/projectBillingConfigActions';

/**
 * Format an integer-cents amount using the config currency (falling back to USD).
 * The billing actions return every money value as integer minor units, so the UI
 * always formats through here and never hand-divides by 100.
 */
export function formatCents(cents: number | null | undefined, currency: string | null | undefined): string {
  return formatCurrencyFromMinorUnits(cents ?? 0, 'en-US', currency ?? 'USD');
}

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
  pending: {
    chip: 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-300',
    dot: 'bg-gray-400',
    labelKey: 'pending',
  },
  canceled: {
    chip: 'bg-gray-100 text-gray-400 line-through dark:bg-gray-500/10 dark:text-gray-500',
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
  approved: 3,
  invoiced: 4,
};

export interface PhaseBillingBadge {
  status: ProjectBillingScheduleStatus;
  /** Summed computed amount of the phase's non-canceled linked entries, in cents. */
  amountCents: number;
  currency: string | null;
}

/**
 * Reduce a project's schedule entries to one badge per phase (F136): the phase
 * shows the most-progressed status among its linked entries, with the summed
 * amount. Canceled entries and unlinked entries are ignored.
 */
export function derivePhaseBillingBadges(
  entries: ScheduleEntryView[],
  currency: string | null,
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
      };
      continue;
    }
    existing.amountCents += entry.computed_amount;
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
