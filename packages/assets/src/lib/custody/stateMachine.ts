import type { CustodyEventType, CustodyState } from '@alga-psa/types';

/**
 * The custody state machine, pure (design D4).
 *
 *   in_office   --moved / handed_off--> in_office
 *   in_office   --shipped-->            with_vendor
 *   with_vendor --received-->           in_office
 *   in_office | with_vendor --returned--> closed
 *
 * `received` as the FIRST event opens an episode (there is no prior state); it is not a transition.
 * Everything else is refused.
 */
const TRANSITIONS: Record<CustodyState, Partial<Record<CustodyEventType, CustodyState>>> = {
  in_office: { moved: 'in_office', handed_off: 'in_office', shipped: 'with_vendor', returned: 'closed' },
  with_vendor: { received: 'in_office', returned: 'closed' },
  closed: {},
};

export class CustodyTransitionError extends Error {
  constructor(public readonly from: CustodyState, public readonly eventType: CustodyEventType) {
    super(
      from === 'closed'
        ? 'This custody episode is already closed.'
        : `A "${eventType}" step is not allowed while the item is ${from === 'in_office' ? 'in the office' : 'with the vendor'}.`
    );
    this.name = 'CustodyTransitionError';
  }
}

export function nextCustodyState(from: CustodyState, eventType: CustodyEventType): CustodyState | null {
  return TRANSITIONS[from][eventType] ?? null;
}

export function assertCustodyTransition(from: CustodyState, eventType: CustodyEventType): CustodyState {
  const next = nextCustodyState(from, eventType);
  if (!next) throw new CustodyTransitionError(from, eventType);
  return next;
}

export function allowedCustodyEvents(from: CustodyState): CustodyEventType[] {
  return Object.keys(TRANSITIONS[from]) as CustodyEventType[];
}
