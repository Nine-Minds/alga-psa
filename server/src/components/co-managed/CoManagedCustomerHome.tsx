'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedWorkspaceState, type CoManagedWorkspaceState } from '@/lib/actions/coManagedWorkspaceActions';
import CoManagedRelationshipHistory from './CoManagedRelationshipHistory';

/** `/msp/co-managed` for a customer workspace: its own relationship — who
 * sponsors it, its seats — and the relationship's event history. */
export default function CoManagedCustomerHome() {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<CoManagedWorkspaceState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getCoManagedWorkspaceState().then((s) => { if (live) setState(s); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) return <div role="alert" className="p-6">{t('coManaged.workspace.error', { defaultValue: 'Co-managed IT could not be loaded.' })}</div>;
  if (!state) return <div role="status" className="p-6">{t('coManaged.workspace.loading', { defaultValue: 'Loading…' })}</div>;

  return (
    <div id="co-managed-customer-home" className="mx-auto max-w-4xl space-y-4 p-6">
      {state.kind === 'none' && (
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('coManaged.workspace.none', { defaultValue: 'This workspace has no co-managed IT relationship.' })}
        </p>
      )}
      {state.kind === 'live' && (
        <Card id="co-managed-home-relationship">
          <CardHeader><CardTitle>{t('coManaged.workspace.title', { defaultValue: 'Co-managed IT' })}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-[rgb(var(--color-text-500))]">{t('coManaged.workspace.sponsor', { defaultValue: 'Managed by' })}</dt>
                <dd className="font-medium">{state.sponsorName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[rgb(var(--color-text-500))]">{t('coManaged.provisioning.seats', { defaultValue: 'Seats' })}</dt>
                <dd className="font-medium">
                  {state.seats == null ? '—'
                    : state.usedSeats != null
                      ? t('coManaged.client.seatUsage', { defaultValue: '{{used}} of {{count}} technician seats', used: state.usedSeats, count: state.seats })
                      : t('coManaged.client.seatAllocation', { defaultValue: '{{count}} allocated technician seats', count: state.seats })}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
      {state.kind !== 'none' && <CoManagedRelationshipHistory idPrefix="co-managed-home" />}
    </div>
  );
}
