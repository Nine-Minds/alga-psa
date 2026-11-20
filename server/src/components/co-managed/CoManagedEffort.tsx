'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { CoManagedEffortTotals } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getSharedEffortTotalsAction, type CoManagedEffortTarget } from '@/lib/actions/coManagedTimeActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import { useCoManagedEffortPerspective } from './coManagedEffortPerspective';

type Props = { target: CoManagedEffortTarget; refreshKey?: number; /** `inline` is the borderless split shown under a native time summary. */ variant?: 'card' | 'inline' };
const FIELDS = ['customerMinutes', 'mspMinutes', 'combinedMinutes'] as const;

/** Effort is retained history: it keeps showing for a workspace that still `serves` co-managed. */
export default function CoManagedEffort(props: Props) {
  const { data: session, status } = useSession();
  const user = session?.user;
  if (status !== 'authenticated' || !user?.id || !user.tenant) return null;
  return <CoManagedFeatureBoundary mode="serves"><Effort key={JSON.stringify([user.tenant, user.id, props.target])} {...props} /></CoManagedFeatureBoundary>;
}

function Effort({ target, refreshKey, variant = 'card' }: Props) {
  const { t } = useTranslation('msp/co-managed-time'), { formatNumber } = useFormatters();
  // A local project/task target is the customer's own work by construction; a shared ticket is seen from whichever side mounted it.
  const mountedPerspective = useCoManagedEffortPerspective();
  const customerView = target.kind !== 'shared' || mountedPerspective === 'customer';
  const label = (field: typeof FIELDS[number]) => t(customerView && field !== 'combinedMinutes' ? `effort.customerView.${field}` : `effort.${field}`);
  const qualifiedTarget = useRef(target);
  const [totals, setTotals] = useState<CoManagedEffortTotals | null>(null);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setTotals(null); setError(false);
    void getSharedEffortTotalsAction(qualifiedTarget.current).then(result => { if (active) setTotals(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [refreshKey, refresh]);
  const identity = target.kind === 'shared' ? `${target.resource.tenant}-${target.resource.kind}-${target.resource.id}`
    : target.kind === 'local_project' ? `project-${target.projectId}` : `task-${target.taskId}`;
  const minutes = (field: typeof FIELDS[number]) => {
    const value = totals?.[field];
    return value === null || value === undefined ? t('effort.unavailable') : t('effort.hours', { value: formatNumber(value / 60, { maximumFractionDigits: 2 }) });
  };
  if (variant === 'inline') return <div className="mt-2 space-y-1" id={`co-effort-split-${identity}`} aria-label={t('effort.title')}>
    <p className="text-xs font-medium text-muted-foreground">{t('effort.title')}</p>
    {error ? <p role="alert" className="text-xs">{t('effort.error')}</p> : !totals ? <p role="status" className="text-xs text-muted-foreground">{t('loading')}</p> :
      <dl className="grid grid-cols-3 gap-2">{FIELDS.map(field => <div key={field}>
        <dt className="text-xs text-muted-foreground">{label(field)}</dt>
        <dd className="text-sm font-semibold tabular-nums">{minutes(field)}</dd>
      </div>)}</dl>}
  </div>;
  return <section className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4" aria-label={t('effort.title')}>
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">{t('effort.title')}</h2>
      <Button id={`co-shared-effort-refresh-${identity}`} type="button" variant="ghost" disabled={!totals && !error}
        onClick={() => { setTotals(null); setError(false); setRefresh(value => value + 1); }}>{t('reload')}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{t('effort.description')}</p>
    {error ? <p role="alert">{t('effort.error')}</p> : !totals ? <p role="status">{t('loading')}</p> :
      <dl className="grid gap-4 sm:grid-cols-3">{FIELDS.map(field => <div key={field}>
        <dt className="text-sm text-muted-foreground">{label(field)}</dt>
        <dd className="font-semibold tabular-nums">{minutes(field)}</dd>
      </div>)}</dl>}
  </section>;
}
