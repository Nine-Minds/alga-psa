/**
 * "Started" has two failure modes, and only one of them is an error envelope.
 *
 * startEntraSync returns `success: true` with `accepted: false` when the
 * background worker could not be reached — the request was fine, the sync
 * simply never began. Every button that starts a sync used to read the envelope
 * only and report "Sync started", which is the same shape of lie as a schedule
 * that saves without being applied: the operator waits for a run that will
 * never appear.
 */
export interface EntraSyncStartEnvelope {
  data?: {
    accepted?: boolean;
    runId?: string | null;
    workflowId?: string | null;
    error?: string | null;
  } | null;
}

export function wasEntraSyncAccepted(result: EntraSyncStartEnvelope): boolean {
  // Absent means an older route that only answered with a run id; treat the
  // presence of the run as acceptance rather than failing closed on a working sync.
  const accepted = result?.data?.accepted;
  if (accepted === undefined) {
    return true;
  }
  return accepted === true;
}
