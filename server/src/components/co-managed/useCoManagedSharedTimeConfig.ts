'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import type { TicketDataSource } from '@alga-psa/tickets/lib/ticketDataSource';
import { resolveTimeWorkItemAction } from '@/lib/actions/coManagedTimeActions';

type TicketTimeConfig = TicketDataSource['time'];

/**
 * `TicketDataSource.time` for a shared (sponsor-tenant) ticket. The work item is the MSP's own routing
 * reference (`co_managed`), resolved under the update authority (a viewer without it gets no stopwatch or
 * entry flow). Until it resolves the work item is the non-tracked `ad_hoc` type, so the stopwatch stays
 * hidden instead of binding to the customer tenant's ticket id.
 */
export function useCoManagedSharedTimeConfig(resource: CoManagedSharedResource | null, canWrite: boolean): TicketTimeConfig {
  const key = resource ? JSON.stringify(resource) : '';
  const [reference, setReference] = useState<{ key: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    setReference(null);
    if (!resource || !canWrite) return;
    void resolveTimeWorkItemAction(resource).then(work => { if (active && work.workItemType === 'co_managed') setReference({ key, id: work.workItemId }); }).catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable identity of `resource`.
  }, [key, canWrite]);
  const referenceId = reference?.key === key ? reference.id : null;
  return useMemo<TicketTimeConfig>(() => ({
    resolveWorkItem: () => referenceId ? { workItemType: 'co_managed' as any, workItemId: referenceId } : { workItemType: 'ad_hoc', workItemId: '' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [referenceId]);
}
