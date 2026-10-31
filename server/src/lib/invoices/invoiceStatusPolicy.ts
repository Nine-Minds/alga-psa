/**
 * Invoice status transition policy (alga-2026-0002945).
 *
 * The generic invoice update and the bulk status route are metadata writers:
 * they must never move an invoice through a transition that has a dedicated
 * command, because the command carries the guards and side effects (payment and
 * consumed-credit checks, credit reversal, hour blocks, provider propagation,
 * payment-link cleanup, finalized_at, audit). This module is the single source
 * of truth for which `(from, to)` pairs the generic paths may write.
 *
 * Adding a status to INVOICE_STATUSES fails typecheck until every row and
 * column of INVOICE_STATUS_TRANSITIONS classifies it.
 */
import { ConflictError } from '../api/middleware/apiMiddleware';

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled',
  'pending',
  'prepayment',
  'partially_applied',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type InvoiceStatusCommand = {
  /** Name of the dedicated command that owns this transition. */
  command: 'recordPayment' | 'void' | 'finalizeInvoice';
  /** RBAC permission (resource:action) the command requires. */
  permission: 'invoice:payment' | 'invoice:void' | 'invoice:finalize';
};

export type InvoiceStatusTransition =
  | { kind: 'noop' }
  | { kind: 'plain' }
  | ({ kind: 'command' } & InvoiceStatusCommand)
  | { kind: 'invalid'; reason?: string };

const NOOP: InvoiceStatusTransition = { kind: 'noop' };
const PLAIN: InvoiceStatusTransition = { kind: 'plain' };
const INVALID: InvoiceStatusTransition = { kind: 'invalid' };
// Setting a status on a payment-bearing transition must go through recordPayment.
const PAY: InvoiceStatusTransition = { kind: 'command', command: 'recordPayment', permission: 'invoice:payment' };
const VOID: InvoiceStatusTransition = { kind: 'command', command: 'void', permission: 'invoice:void' };
// draft -> sent is what finalizeInvoice does (it also sets finalized_at).
const FINALIZE: InvoiceStatusTransition = { kind: 'command', command: 'finalizeInvoice', permission: 'invoice:finalize' };
const PAID_LOCKED: InvoiceStatusTransition = { kind: 'invalid', reason: 'Cannot modify paid invoice status' };

type Row = Record<InvoiceStatus, InvoiceStatusTransition>;

/**
 * INVOICE_STATUS_TRANSITIONS[from][to]. Columns follow INVOICE_STATUSES order:
 * draft, sent, paid, overdue, cancelled, pending, prepayment, partially_applied.
 */
export const INVOICE_STATUS_TRANSITIONS = {
  draft: {
    draft: NOOP, sent: FINALIZE, paid: INVALID, overdue: INVALID,
    cancelled: VOID, pending: INVALID, prepayment: INVALID, partially_applied: INVALID,
  },
  sent: {
    draft: INVALID, sent: NOOP, paid: PAY, overdue: PLAIN,
    cancelled: VOID, pending: INVALID, prepayment: INVALID, partially_applied: PLAIN,
  },
  paid: {
    draft: PAID_LOCKED, sent: PAID_LOCKED, paid: NOOP, overdue: PAID_LOCKED,
    cancelled: PAID_LOCKED, pending: PAID_LOCKED, prepayment: PAID_LOCKED, partially_applied: PAID_LOCKED,
  },
  overdue: {
    draft: INVALID, sent: INVALID, paid: PAY, overdue: NOOP,
    cancelled: VOID, pending: INVALID, prepayment: INVALID, partially_applied: PLAIN,
  },
  cancelled: {
    draft: INVALID, sent: INVALID, paid: INVALID, overdue: INVALID,
    cancelled: NOOP, pending: INVALID, prepayment: INVALID, partially_applied: INVALID,
  },
  pending: {
    draft: INVALID, sent: PLAIN, paid: INVALID, overdue: INVALID,
    cancelled: VOID, pending: NOOP, prepayment: INVALID, partially_applied: INVALID,
  },
  prepayment: {
    draft: INVALID, sent: INVALID, paid: PAY, overdue: INVALID,
    cancelled: VOID, pending: INVALID, prepayment: NOOP, partially_applied: INVALID,
  },
  partially_applied: {
    draft: INVALID, sent: PLAIN, paid: PAY, overdue: PLAIN,
    cancelled: VOID, pending: INVALID, prepayment: INVALID, partially_applied: NOOP,
  },
} as const satisfies Record<InvoiceStatus, Row>;

/** Statuses the generic update/bulk paths can write from at least one state. */
export const PLAIN_REACHABLE_INVOICE_STATUSES = INVOICE_STATUSES.filter((to) =>
  INVOICE_STATUSES.some((from) => INVOICE_STATUS_TRANSITIONS[from][to].kind === 'plain'),
) as [InvoiceStatus, ...InvoiceStatus[]];

export function classifyStatusChange(from: string, to: string): InvoiceStatusTransition {
  const row = (INVOICE_STATUS_TRANSITIONS as Record<string, Row | undefined>)[from];
  // Unknown legacy/foreign statuses fail closed.
  return row?.[to as InvoiceStatus] ?? INVALID;
}

/** Human-readable reason a transition cannot be made via the generic paths; null when allowed. */
export function describeStatusChangeBlock(from: string, to: string): string | null {
  const t = classifyStatusChange(from, to);
  switch (t.kind) {
    case 'noop':
    case 'plain':
      return null;
    case 'command':
      return `Changing invoice status from ${from} to ${to} must use the ${t.command} command (requires ${t.permission}); it cannot be set through the generic status update`;
    default:
      return t.reason ?? `Invalid status transition from ${from} to ${to}`;
  }
}

export function assertStatusChangeAllowed(from: string, to: string): void {
  const message = describeStatusChangeBlock(from, to);
  if (message) {
    throw new ConflictError(message);
  }
}
