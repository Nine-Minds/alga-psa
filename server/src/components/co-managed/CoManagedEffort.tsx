'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { CoManagedEffortTotals } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getSharedEffortTotalsAction, type CoManagedEffortTarget } from '@/lib/actions/coManagedTimeActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';

type Props = { target: CoManagedEffortTarget; refreshKey?: number };

export default function CoManagedEffort(props: Props) {
  const { data: session, status } = useSession();
  const user = session?.user;
  if (status !== 'authenticated' || !user?.id || !user.tenant) return null;
  return <CoManagedFeatureBoundary><Effort key={JSON.stringify([user.tenant, user.id, props.target])} {...props} /></CoManagedFeatureBoundary>;
}

function Effort({ target, refreshKey }: Props) {
  const { t } = useTranslation('msp/licensing'), { formatNumber } = useFormatters();
  const qualifiedTarget = useRef(target);
  const [totals, setTotals] = useState<CoManagedEffortTotals | null>(null);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setTotals(null); setError(false);
    void getSharedEffortTotalsAction(qualifiedTarget.current).then(result => {
      if (active) setTotals(result);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [refreshKey, refresh]);
  const fields = ['customerMinutes', 'mspMinutes', 'combinedMinutes'] as const;
  const identity = target.kind === 'shared' ? `${target.resource.tenant}-${target.resource.kind}-${target.resource.id}`
    : target.kind === 'local_project' ? `project-${target.projectId}` : `task-${target.taskId}`;
  return <section className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4" aria-label={t('coManaged.effort.title')}>
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">{t('coManaged.effort.title')}</h2>
      <Button id={`co-shared-effort-refresh-${identity}`} type="button" variant="ghost" disabled={!totals && !error}
        onClick={() => { setTotals(null); setError(false); setRefresh(value => value + 1); }}>{t('coManaged.policy.reload')}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{t('coManaged.effort.description')}</p>
    {error ? <p role="alert">{t('coManaged.effort.error')}</p> : !totals ? <p role="status">{t('coManaged.loading')}</p> :
      <dl className="grid gap-4 sm:grid-cols-3">{fields.map(field => <div key={field}>
        <dt className="text-sm text-muted-foreground">{t(`coManaged.effort.${field}`)}</dt>
        <dd className="font-semibold tabular-nums">{totals[field] === null ? t('coManaged.effort.unavailable')
          : t('coManaged.effort.hours', { value: formatNumber(totals[field] / 60, { maximumFractionDigits: 2 }) })}</dd>
      </div>)}</dl>}
  </section>;
}
