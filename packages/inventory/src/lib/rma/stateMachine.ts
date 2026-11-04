import type { RmaClosedReason, RmaEventType, RmaStatus } from '@alga-psa/types';

/**
 * The warranty-claim state machine, pure (C5 PRD "State machine", transitions 2–13).
 *
 * A warranty claim is a client-asset RMA: `returned_unit_id IS NULL` (see `isAssetTracked`). It shares
 * `rma_cases` with the stock-unit tracks but none of their writers: nothing here knows about stock units,
 * movements or levels, and the table is the whole contract.
 *
 *   warranty_review --approve(standard)--> awaiting_return --device received--> returned --ship--> sent_to_vendor
 *   warranty_review --approve(advance)---> open --(vendor replacement)--> replaced
 *   warranty_review --deny / cancel------> closed
 *   sent_to_vendor  --replacement--> replaced | --repair--> repaired | --credit--> credited
 *   open            --credit--> credited
 *   replaced | repaired --return to client--> closed
 *   replaced | repaired | credited | returned --close--> closed
 *
 * `warranty_review` can only be left through approve, deny or cancel; the generic `close` is refused there
 * so the decision step cannot be bypassed.
 */
export type WarrantyAction =
  | 'approve_standard'
  | 'approve_advance'
  | 'deny'
  | 'cancel'
  | 'mark_device_received'
  | 'ship_to_vendor'
  | 'receive_replacement'
  | 'record_repair'
  | 'record_credit'
  | 'return_to_client'
  | 'close';

export interface WarrantyTransition {
  from: readonly RmaStatus[];
  to: RmaStatus;
  eventType: RmaEventType;
  /** Closing transitions stamp `closed_at`; the reason is fixed here or supplied by the caller. */
  closes: boolean;
  fixedClosedReason?: RmaClosedReason;
  /** Needs `asset:update` (and the record check) in addition to `warranty:update`. */
  writesAsset: boolean;
}

export const WARRANTY_TRANSITIONS: Readonly<Record<WarrantyAction, WarrantyTransition>> = {
  approve_standard: { from: ['warranty_review'], to: 'awaiting_return', eventType: 'warranty_approved', closes: false, writesAsset: false },
  approve_advance: { from: ['warranty_review'], to: 'open', eventType: 'warranty_approved', closes: false, writesAsset: false },
  deny: { from: ['warranty_review'], to: 'closed', eventType: 'warranty_denied', closes: true, fixedClosedReason: 'warranty_denied', writesAsset: false },
  cancel: { from: ['warranty_review'], to: 'closed', eventType: 'closed', closes: true, writesAsset: false },
  mark_device_received: { from: ['awaiting_return'], to: 'returned', eventType: 'device_received', closes: false, writesAsset: true },
  ship_to_vendor: { from: ['returned'], to: 'sent_to_vendor', eventType: 'shipped_outbound', closes: false, writesAsset: true },
  receive_replacement: { from: ['open', 'sent_to_vendor'], to: 'replaced', eventType: 'replacement_received', closes: false, writesAsset: true },
  record_repair: { from: ['sent_to_vendor'], to: 'repaired', eventType: 'repair_received', closes: false, writesAsset: true },
  record_credit: { from: ['sent_to_vendor', 'open'], to: 'credited', eventType: 'vendor_credited', closes: false, writesAsset: false },
  return_to_client: { from: ['replaced', 'repaired'], to: 'closed', eventType: 'returned_to_client', closes: true, fixedClosedReason: 'resolved', writesAsset: true },
  close: { from: ['replaced', 'repaired', 'credited', 'returned'], to: 'closed', eventType: 'closed', closes: true, writesAsset: false },
};

export const WARRANTY_ACTIONS = Object.keys(WARRANTY_TRANSITIONS) as WarrantyAction[];

/** The only reasons a caller may choose for a plain cancel/close. `warranty_denied` belongs to `deny`. */
export const CALLER_CLOSE_REASONS = ['resolved', 'cancelled', 'duplicate', 'vendor_credited'] as const satisfies readonly RmaClosedReason[];
export const CANCEL_REASONS = ['cancelled', 'duplicate'] as const satisfies readonly RmaClosedReason[];

export type RmaTransitionErrorCode = 'invalid_transition' | 'warranty_review_close';

export class RmaTransitionError extends Error {
  constructor(
    public readonly code: RmaTransitionErrorCode,
    public readonly from: RmaStatus,
    public readonly action: WarrantyAction,
    message: string,
  ) {
    super(message);
    this.name = 'RmaTransitionError';
  }
}

export function nextWarrantyStatus(from: RmaStatus, action: WarrantyAction): RmaStatus | null {
  const t = WARRANTY_TRANSITIONS[action];
  return t.from.includes(from) ? t.to : null;
}

export function assertWarrantyTransition(from: RmaStatus, action: WarrantyAction): WarrantyTransition {
  const t = WARRANTY_TRANSITIONS[action];
  if (t.from.includes(from)) return t;
  if (action === 'close' && from === 'warranty_review') {
    throw new RmaTransitionError(
      'warranty_review_close',
      from,
      action,
      'A warranty claim must be approved, denied or cancelled before it can be closed.',
    );
  }
  throw new RmaTransitionError(
    'invalid_transition',
    from,
    action,
    `RMA is in status '${from}'; expected one of: ${t.from.join(', ')}`,
  );
}

export function allowedWarrantyActions(from: RmaStatus): WarrantyAction[] {
  return WARRANTY_ACTIONS.filter((a) => WARRANTY_TRANSITIONS[a].from.includes(from));
}

/**
 * Ownership discriminator (PRD): a case is a client-asset warranty claim exactly when it has no returned
 * stock unit. There is deliberately no second column to keep in sync, and no warranty path may set
 * `returned_unit_id`.
 */
export function isAssetTracked(rma: { returned_unit_id?: string | null }): boolean {
  return rma.returned_unit_id == null;
}
