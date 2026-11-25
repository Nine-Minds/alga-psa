'use client';

import CoManagedSeatTrial from '@enterprise/components/co-managed/CoManagedSeatTrial';
import { useSeatTrialOffer } from './useSeatTrialOffer';

/** The trial card with its own offer read, for pages that show no Enable chooser (the overview). */
export default function CoManagedSeatTrialSection({ clientId, onChanged }: { clientId?: string; onChanged?: () => void }) {
  const { offer, reload } = useSeatTrialOffer(clientId);
  return <CoManagedSeatTrial offer={offer} onReload={reload} clientId={clientId} onChanged={onChanged} />;
}
