'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { prepareTimeEntryForWorkItem, NewWorkItemTimeEntry } from '@alga-psa/scheduling/lib/timeEntryLauncher';
import { resolveTimeWorkItemAction } from '@/lib/actions/coManagedTimeActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import CoManagedTimeBillingProfile from './CoManagedTimeBillingProfile';

type Props = { resource: CoManagedSharedResource; canWrite: boolean; onSaved?: () => void };
type Prepared = NonNullable<Awaited<ReturnType<typeof prepareTimeEntryForWorkItem>>>;

/** The form belongs to this qualified screen, so navigation, access loss and
 * flag changes unmount both its private notes and pending preparation. */
export default function CoManagedTimeEntry(props: Props) {
  return <CoManagedFeatureBoundary>{props.canWrite && <TimeEntry key={JSON.stringify(props.resource)} resource={props.resource} onSaved={props.onSaved} />}</CoManagedFeatureBoundary>;
}
function TimeEntry({ resource, onSaved }: Pick<Props, 'resource' | 'onSaved'>) {
  const { t } = useTranslation('msp/licensing');
  const target = useRef({ ...resource });
  const mounted = useRef(false), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [prepared, setPrepared] = useState<Prepared | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function open() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      const work = await resolveTimeWorkItemAction(target.current);
      if (!mounted.current) return;
      const result = await prepareTimeEntryForWorkItem({ ...work, workItemName: work.workItemName || t('coManaged.ticket.restricted') });
      if (mounted.current && result) setPrepared(result);
    } catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) { inFlight.current = false; setBusy(false); } }
  }
  return <div className="space-y-2">
    <CoManagedTimeBillingProfile resource={target.current} disabled={busy || !!prepared} onBusyChange={setProfileBusy} />
    <Button id="co-shared-log-time" variant="outline" disabled={busy || profileBusy || !!prepared} onClick={() => void open()}>{t(busy ? 'coManaged.loading' : 'coManaged.time.log')}</Button>
    {error && <p role="alert">{t('coManaged.time.unavailable')}</p>}
    {prepared && <div id="co-shared-time-entry"><NewWorkItemTimeEntry {...prepared} closeDrawer={() => setPrepared(null)}
      onComplete={() => { if (mounted.current) { setPrepared(null); onSaved?.(); } }} /></div>}
  </div>;
}
