'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { launchTimeEntryForWorkItem } from '@alga-psa/scheduling/lib/timeEntryLauncher';
import { resolveTimeWorkItemAction } from '@/lib/actions/coManagedTimeActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import CoManagedTimeBillingProfile from './CoManagedTimeBillingProfile';

type Props = { resource: CoManagedSharedResource; canWrite: boolean; onSaved?: () => void };

/**
 * Opens the native time-entry drawer for qualified shared work. The form belongs to this screen, so
 * navigation, access loss and capability changes unmount both its private notes and pending preparation.
 * MSP staff reach a `co_managed` (billable) work item; customer staff reach their own native ticket/task,
 * and the provider records that entry as operational.
 */
export default function CoManagedTimeEntry(props: Props) {
  return <CoManagedFeatureBoundary mode="serves">{props.canWrite && <TimeEntry key={JSON.stringify(props.resource)} resource={props.resource} onSaved={props.onSaved} />}</CoManagedFeatureBoundary>;
}
function TimeEntry({ resource, onSaved }: Pick<Props, 'resource' | 'onSaved'>) {
  const { t } = useTranslation('msp/co-managed-time');
  const { openDrawer, closeDrawer } = useDrawer();
  const target = useRef({ ...resource });
  const mounted = useRef(false), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [profileBusy, setProfileBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function open() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      const work = await resolveTimeWorkItemAction(target.current);
      if (!mounted.current) return;
      await launchTimeEntryForWorkItem({ openDrawer, closeDrawer,
        context: { workItemId: work.workItemId, workItemType: work.workItemType as any, workItemName: work.workItemName || t('ticket.restricted') } as any,
        onComplete: () => { if (mounted.current) onSaved?.(); } });
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) { inFlight.current = false; setBusy(false); } }
  }
  return <div className="space-y-2">
    <CoManagedTimeBillingProfile resource={target.current} disabled={busy} onBusyChange={setProfileBusy} />
    <Button id="co-shared-log-time" variant="outline" disabled={busy || profileBusy} onClick={() => void open()}>{t(busy ? 'loading' : 'time.log')}</Button>
    {error && <p role="alert">{t('time.unavailable')}</p>}
  </div>;
}
