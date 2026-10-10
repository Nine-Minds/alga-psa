import type {
  CadenceOwner,
  DuePosition,
  IRecurringDateRange,
  ISO8601String,
} from '@alga-psa/types';

function toDateOnly(value: ISO8601String | Date): ISO8601String {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10) as ISO8601String;
  }

  return `${value.slice(0, 10)}` as ISO8601String;
}

/**
 * Canonical schedule key: `schedule:{tenant}:{obligationId}:{cadenceOwner}:{duePosition}`.
 * `cadenceOwner` is the only cadence discriminator; there is no obligation-type label.
 */
export function buildRecurringServicePeriodScheduleKey(input: {
  tenant: string;
  obligationId: string;
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
}) {
  return `schedule:${input.tenant}:${input.obligationId}:${input.cadenceOwner}:${input.duePosition}`;
}

export interface ParsedRecurringServicePeriodScheduleKey {
  tenant: string;
  obligationId: string;
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  /** Always the canonical (5-segment) key, even when parsed from a legacy key. */
  scheduleKey: string;
}

const CADENCE_OWNERS = new Set<string>(['client', 'contract']);
const DUE_POSITIONS = new Set<string>(['advance', 'arrears']);
// Pre-alga0002072 label segment. Only accepted (and discarded) at input boundaries.
const LEGACY_OBLIGATION_TYPES = new Set<string>([
  'contract_line',
  'client_contract_line',
  'template_line',
  'preset_line',
]);

/**
 * Parse a schedule key into its parts, returning the canonical key.
 *
 * Accepts the canonical 5-segment key and, for transient inputs only (deep
 * links, sessionStorage selections, REST `selector_input.executionWindow.scheduleKey`),
 * the legacy 6-segment key with an obligation-type label. Nothing may ever
 * write or query by a legacy key.
 *
 * Rejects `schedule:{tenant}:unresolved:{time|usage}:{id}` keys: they also have
 * five segments, but the cadence/due enums do not match.
 */
export function parseRecurringServicePeriodScheduleKey(
  key: string | null | undefined,
): ParsedRecurringServicePeriodScheduleKey | null {
  if (typeof key !== 'string') {
    return null;
  }
  const segments = key.split(':');
  if (segments[0] !== 'schedule' || segments.some((segment) => segment.length === 0)) {
    return null;
  }

  let tenant: string;
  let obligationId: string;
  let cadenceOwner: string;
  let duePosition: string;
  if (segments.length === 5) {
    [, tenant, obligationId, cadenceOwner, duePosition] = segments;
  } else if (segments.length === 6) {
    // LEGACY: remove once no pre-alga0002072 deep links / sessionStorage /
    // API callers can exist (review after 2027-04-10).
    let label: string;
    [, tenant, label, obligationId, cadenceOwner, duePosition] = segments;
    if (!LEGACY_OBLIGATION_TYPES.has(label)) {
      return null;
    }
  } else {
    return null;
  }

  if (!CADENCE_OWNERS.has(cadenceOwner) || !DUE_POSITIONS.has(duePosition)) {
    return null;
  }

  return {
    tenant,
    obligationId,
    cadenceOwner: cadenceOwner as CadenceOwner,
    duePosition: duePosition as DuePosition,
    scheduleKey: buildRecurringServicePeriodScheduleKey({
      tenant,
      obligationId,
      cadenceOwner: cadenceOwner as CadenceOwner,
      duePosition: duePosition as DuePosition,
    }),
  };
}

/** Canonicalize a schedule key from a transient input; returns the input unchanged if unparseable. */
export function canonicalizeRecurringServicePeriodScheduleKey(key: string): string {
  return parseRecurringServicePeriodScheduleKey(key)?.scheduleKey ?? key;
}

export function buildRecurringServicePeriodPeriodKey(
  period: Pick<IRecurringDateRange, 'start' | 'end'>,
) {
  return `period:${toDateOnly(period.start)}:${toDateOnly(period.end)}`;
}
