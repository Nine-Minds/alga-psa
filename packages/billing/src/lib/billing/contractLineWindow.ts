import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { addDaysToDateOnly, isValidDateOnly, toDateOnly } from './dateOnly';

export { isValidDateOnly } from './dateOnly';

/** Normalizes a date-ish value (Date, ISO timestamp, date-only) to a valid `YYYY-MM-DD`. */
export const normalizeContractLineDate = toDateOnly;

export interface ContractLineWindowInput {
  start_date?: string | null;
  end_date?: string | null;
}

export interface ContractLineBillingWindow {
  /**
   * Cadence anchor. Always the contract assignment start, never the authored
   * line start, so the engine and the service-period materializer derive the
   * same period boundaries.
   */
  anchorStart: string | null;
  /** Effective coverage start: the later of the assignment and line starts. */
  coverageStart: string | null;
  /** Inclusive last billed day (`coverageEndExclusive - 1`), for charge rows. */
  inclusiveEnd: string | null;
  /** Half-open exclusive end used for activity/settlement windows. */
  coverageEndExclusive: string | null;
}

/**
 * Resolves the billing window for one contract line.
 *
 * The contract assignment window and the authored line window are both
 * half-open `[start, end)`, matching the canonical recurring service-period
 * materializer (`clipRecurringCandidatesToObligationBounds`), so the derived
 * engine path and the persisted path agree at the boundary. A null line bound
 * inherits the assignment bound. `inclusiveEnd` is the last billed day for
 * display/charge rows (`coverageEndExclusive - 1`).
 */
export function resolveContractLineBillingWindow(
  assignment: { start_date?: unknown; end_date?: unknown },
  line: { start_date?: unknown; end_date?: unknown },
): ContractLineBillingWindow {
  const assignmentStart = normalizeContractLineDate(assignment.start_date);
  const assignmentEnd = normalizeContractLineDate(assignment.end_date);
  const lineStart = normalizeContractLineDate(line.start_date);
  const lineEnd = normalizeContractLineDate(line.end_date);

  const coverageStart = lineStart && assignmentStart
    ? (lineStart > assignmentStart ? lineStart : assignmentStart)
    : (lineStart ?? assignmentStart);

  const coverageEndExclusive = assignmentEnd && lineEnd
    ? (lineEnd < assignmentEnd ? lineEnd : assignmentEnd)
    : (lineEnd ?? assignmentEnd);

  return {
    anchorStart: assignmentStart,
    coverageStart,
    inclusiveEnd: coverageEndExclusive
      ? addDaysToDateOnly(coverageEndExclusive, -1)
      : null,
    coverageEndExclusive,
  };
}

/**
 * Validates authored contract-line start/end dates.
 *
 * Returns a user-safe error string, or null when the dates are valid. Dates must
 * be real calendar dates, must not invert, and must fall inside the active
 * `client_contracts` assignment for the contract. A partial update merges with
 * the line's existing bounds first, so changing only one side cannot silently
 * produce an inverted window. When the contract has no active assignment there
 * is no client period to constrain to, so only intrinsic ordering is enforced.
 */
export async function validateContractLineWindow(
  trx: Knex.Transaction,
  tenant: string,
  contractId: string,
  input: ContractLineWindowInput,
  existing?: ContractLineWindowInput,
): Promise<string | null> {
  const startProvided = input.start_date !== undefined;
  const endProvided = input.end_date !== undefined;

  // A provided null clears the bound; an omitted field keeps the existing one.
  // Existing values may be driver `Date`s, so normalize them before comparing.
  const startText = startProvided
    ? (input.start_date == null ? null : String(input.start_date).trim())
    : normalizeContractLineDate(existing?.start_date);
  const endText = endProvided
    ? (input.end_date == null ? null : String(input.end_date).trim())
    : normalizeContractLineDate(existing?.end_date);

  if (startText && !isValidDateOnly(startText)) {
    return 'Line start date must be a valid date.';
  }
  if (endText && !isValidDateOnly(endText)) {
    return 'Line end date must be a valid date.';
  }

  const start = startText || null;
  const end = endText || null;
  if (start && end && end <= start) {
    return 'Line end date must be after the line start date.';
  }

  // No authored bound means nothing to constrain to the assignment; skip the
  // lookup so flows that never touch dates add no query.
  if (!start && !end) {
    return null;
  }

  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  const assignment = await query
    .where({ 'cc.contract_id': contractId, 'cc.is_active': true })
    .first('cc.start_date', 'cc.end_date');

  const assignmentStart = normalizeContractLineDate(assignment?.start_date);
  const assignmentEnd = normalizeContractLineDate(assignment?.end_date);

  if (start && assignmentStart && start < assignmentStart) {
    return 'Line start date cannot be before the client contract starts.';
  }
  if (end && assignmentEnd && end > assignmentEnd) {
    return 'Line end date cannot be after the client contract ends.';
  }
  return null;
}
