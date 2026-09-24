import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Normalizes a date-ish value (Date, ISO timestamp, date-only) to `YYYY-MM-DD`. */
export function normalizeContractLineDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export interface ContractLineWindowInput {
  start_date?: string | null;
  end_date?: string | null;
}

export interface EffectiveContractLineWindow {
  start_date: string | null;
  end_date: string | null;
}

/**
 * Intersects a contract assignment window with an authored line window.
 *
 * Both are half-open `[start, end)`. A null line bound inherits the assignment
 * bound, so a line with no authored dates keeps its previous behavior. When the
 * line window sits entirely before/after the assignment the result is an
 * inverted range (`start > end`); callers treat that as "no coverage" and bill
 * nothing rather than emitting a zero charge.
 */
export function resolveEffectiveContractLineWindow(
  assignment: { start_date?: unknown; end_date?: unknown },
  line: { start_date?: unknown; end_date?: unknown },
): EffectiveContractLineWindow {
  const assignmentStart = normalizeContractLineDate(assignment.start_date);
  const assignmentEnd = normalizeContractLineDate(assignment.end_date);
  const lineStart = normalizeContractLineDate(line.start_date);
  const lineEnd = normalizeContractLineDate(line.end_date);

  const start_date = lineStart && assignmentStart
    ? (lineStart > assignmentStart ? lineStart : assignmentStart)
    : (lineStart ?? assignmentStart);
  const end_date = lineEnd && assignmentEnd
    ? (lineEnd < assignmentEnd ? lineEnd : assignmentEnd)
    : (lineEnd ?? assignmentEnd);

  return { start_date, end_date };
}

/**
 * Validates authored contract-line start/end dates.
 *
 * Returns a user-safe error string, or null when the dates are valid. Dates are
 * half-open (`[start, end)`), must be real `YYYY-MM-DD` values, must not invert,
 * and must fall inside the active `client_contracts` assignment for the
 * contract. When the contract has no active assignment there is no client
 * period to constrain to, so only the intrinsic ordering is enforced.
 */
export async function validateContractLineWindow(
  trx: Knex.Transaction,
  tenant: string,
  contractId: string,
  input: ContractLineWindowInput,
): Promise<string | null> {
  const start = normalizeContractLineDate(input.start_date);
  const end = normalizeContractLineDate(input.end_date);

  if (input.start_date != null && input.start_date !== '' && !start) {
    return 'Line start date must be a valid date.';
  }
  if (input.end_date != null && input.end_date !== '' && !end) {
    return 'Line end date must be a valid date.';
  }
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
