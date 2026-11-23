/**
 * What the Enable surface on a client's Co-managed IT tab says about seats, decided once from the
 * seat trial's state and the paid pool's state so the trial card and the chooser cannot contradict
 * each other. Pure: no JSX, no reads. Model: `clientRelationshipSummary.ts`.
 *
 * Total: every (enable, trial, purchaseOpen) combination is defined.
 *  - `trial === 'none'` reproduces the chooser as it was before the trial story existed.
 *  - Any other trial state is `tone: 'trial'`: the paid-pool requirement is never an error while a
 *    trial is on screen, so `blocker` is null and a 0-of-0 pool is hidden.
 */
export type SeatTrialStory = 'available' | 'pending' | 'active' | 'ended' | 'none';

export interface SeatEnableInput {
  enable: { capacity: { purchased: number; allocated: number; available: number }; blocker: string | null } | null;
  trial: SeatTrialStory;
  purchaseOpen: boolean;
  workspaceOffered: boolean;
}

export interface SeatEnableStory {
  tone: 'blocked' | 'trial';
  /** Destructive alert code; only ever set when `tone === 'blocked'`. */
  blocker: string | null;
  /** Neutral note telling the trial's story; null when there is no trial. */
  notice: SeatTrialStory | null;
  pool: 'count' | 'empty' | 'hidden';
  seatDisabled: boolean;
  seatHint: 'default' | 'afterTrial' | 'trialCovers';
}

export function resolveSeatEnableStory({ enable, trial, purchaseOpen }: SeatEnableInput): SeatEnableStory {
  // A pool with no seats left is only a blocker when it cannot be bought into; every other refusal still stops the paid path.
  const raw = enable?.blocker ?? null;
  const paidPathBlocker = raw === 'CAPACITY_UNAVAILABLE' && purchaseOpen ? null : raw;
  const seatDisabled = paidPathBlocker !== null;
  if (trial === 'none') {
    return { tone: 'blocked', blocker: paidPathBlocker, notice: null, pool: enable ? 'count' : 'hidden', seatDisabled, seatHint: 'default' };
  }
  const pool = enable && enable.capacity.purchased > 0 ? 'count' : 'hidden';
  // Only a running trial has an end date to name; the others say what adding seats keeps.
  const seatHint = !seatDisabled ? 'default' : trial === 'active' ? 'trialCovers' : 'afterTrial';
  return { tone: 'trial', blocker: null, notice: trial, pool, seatDisabled, seatHint };
}
