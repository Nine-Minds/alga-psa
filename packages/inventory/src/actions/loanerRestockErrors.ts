/**
 * Pure error-envelope mapping for the loaner and restock-return actions (split out of
 * the former `loanerRestockActions.ts`). Kept free of `'use server'` and any DB/auth
 * imports so both action files can share it and it can be unit-tested directly
 * (mirrors `packages/documents/src/actions/documentActionErrors.ts`).
 *
 * The mappers turn expected, user-safe failures into `actionError`/`permissionError`
 * envelopes and return `null` for anything unexpected (which the caller rethrows).
 * They are the layer that keeps raw Knex SQL (`22P02`) and snake_case enum values out
 * of user-facing toasts — the exact defects the adversarial review flagged.
 */
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type InventoryActionError = ActionMessageError | ActionPermissionError;

// Human labels for the 8 raw unit statuses, so a status-guard error reads like a
// sentence and never leaks a snake_case enum value into a toast.
const STATUS_LABELS: Record<string, string> = {
  in_stock: 'In stock',
  allocated: 'Allocated',
  in_transit: 'In transit',
  on_loan: 'On loan',
  delivered: 'Delivered',
  returned: 'Returned',
  in_rma: 'In RMA',
  retired: 'Retired',
};

export function humanStatus(raw: string): string {
  return STATUS_LABELS[raw] ?? raw.replace(/_/g, ' ');
}

/** Pull the `(current status: X)` the guard messages embed, so the mapper can humanize it. */
export function currentStatusOf(message: string): string | null {
  const m = message.match(/\(current status: ([^)]+)\)/);
  return m ? m[1] : null;
}

/**
 * Reject a `loan_due_at` we can't store before it hits the DB, and pin date-only
 * strings to an explicit UTC midnight. A due date is a calendar date, not an
 * instant: the UI sends `YYYY-MM-DD`, which Postgres would otherwise parse in the
 * session time zone — silently shifting the stored day. Readers render the UTC
 * date parts (see LoanersManager's fmtDueDate/dueDayDelta) so every viewer sees
 * the calendar date that was picked.
 */
export function normalizeDueDate(value: string | Date | null | undefined): string | Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const utc = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(utc.getTime())) throw new Error('loan_due_at must be a valid date');
    return utc.toISOString();
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('loan_due_at must be a valid date');
  return value;
}

export function loanerActionErrorFrom(error: unknown): InventoryActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'client_id is required to loan out a unit':
        return actionError('Choose a client before loaning out the unit.');
      case 'location_id is required to return a loaner':
        return actionError('Choose a return location.');
      case 'loan_due_at must be a valid date':
        return actionError('Choose a valid due date.');
      case 'Stock unit not found':
        return actionError('Stock unit not found. It may have been updated or deleted. Refresh and try again.');
    }

    // Status guards throw with the raw enum embedded; translate to a sentence here.
    if (error.message.startsWith('Unit must be in_stock ')) {
      const status = currentStatusOf(error.message);
      return actionError(
        status
          ? `This unit can't be loaned out — it's currently ${humanStatus(status)}.`
          : "This unit can't be loaned out.",
      );
    }
    if (error.message.startsWith('Unit must be on_loan ')) {
      const status = currentStatusOf(error.message);
      return actionError(
        status
          ? `This unit isn't out on loan — it's currently ${humanStatus(status)}.`
          : "This unit isn't out on loan.",
      );
    }
  }

  const dbError = error as { code?: string };
  // A serial/MAC typed where a UUID is expected casts to `22P02`; without pickers this
  // is defense-in-depth, but the raw Knex SQL text must never reach a toast.
  if (dbError?.code === '22P02') {
    return actionError("That doesn't look like a valid record reference. Pick the unit and client from the lists.");
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected loaner records is no longer valid. Refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This loaner update conflicts with an existing record. Refresh and try again.');
  }

  return null;
}

export function restockReturnActionErrorFrom(error: unknown): InventoryActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    switch (error.message) {
      case 'Stock unit not found':
        return actionError('Stock unit not found. It may have been updated or deleted. Refresh and try again.');
      case 'restocking_fee_cents must be a non-negative integer (cents)':
        return actionError('Restocking fee must be a non-negative amount.');
      case 'location_id is required to restock this unit':
        return actionError('Choose a location to restock this unit.');
      case 'service_id and location_id are required for a non-serialized restock return':
        return actionError('Choose a product and location before restocking non-serialized inventory.');
      case 'quantity must be a positive number for a non-serialized restock return':
        return actionError('Restock quantity must be greater than zero.');
      case 'This product is serialized; provide unit_id to restock a specific unit':
        return actionError('This product is serialized. Choose the specific unit to restock.');
    }

    if (error.message.startsWith('Unit must be delivered or returned ')) {
      const status = currentStatusOf(error.message);
      return actionError(
        status
          ? `This unit can't be restocked — it's currently ${humanStatus(status)}. Only delivered or returned units can be restocked.`
          : "This unit can't be restocked. Only delivered or returned units can be restocked.",
      );
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError("That doesn't look like a valid record reference. Pick the unit and location from the lists.");
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected records is no longer valid. Refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This restock conflicts with an existing record. Refresh and try again.');
  }

  return null;
}
