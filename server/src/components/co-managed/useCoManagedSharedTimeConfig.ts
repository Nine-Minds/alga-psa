'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import type { TicketDataSource } from '@alga-psa/tickets/lib/ticketDataSource';

type TicketTimeConfig = TicketDataSource['time'];
import { listSharedTimeEntriesAction, registerSharedTimeWorkAction } from '@/lib/actions/coManagedTimeActions';

/**
 * `TicketDataSource.time` for a shared (sponsor-tenant) ticket. The work item is the MSP's local
 * work reference, registered under the existing update authority (a viewer without it simply gets
 * no stopwatch or entry flow). The entries list is keyed by the qualified resource and admitted
 * per entry on the server. Until the reference resolves, the work item is the non-tracked
 * `ad_hoc` type so the stopwatch and entry flow stay hidden instead of binding to the customer
 * tenant's ticket ID.
 */
export function useCoManagedSharedTimeConfig(resource: CoManagedSharedResource | null, canWrite: boolean): TicketTimeConfig {
  const key = resource ? JSON.stringify(resource) : '';
  const [reference, setReference] = useState<{ key: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    setReference(null);
    if (!resource || !canWrite) return;
    void registerSharedTimeWorkAction(resource).then(work => { if (active) setReference({ key, id: work.referenceId }); }).catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable identity of `resource`.
  }, [key, canWrite]);
  const referenceId = reference?.key === key ? reference.id : null;
  return useMemo<TicketTimeConfig>(() => ({
    resolveWorkItem: () => referenceId ? { workItemType: 'co_managed', workItemId: referenceId } : { workItemType: 'ad_hoc', workItemId: '' },
    fetchTimeEntries: () => resource ? listSharedTimeEntriesAction(resource) : Promise.reject(new Error('Shared work is unavailable.')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [referenceId, key]);
}
