'use client';

import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedTicketSlaDisplay, CoManagedSlaTargetDisplay } from '@alga-psa/co-managed';

export default function CoManagedTicketSla({ sla, customerName, sponsorName }: {
  sla: CoManagedTicketSlaDisplay; customerName: string; sponsorName: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const outcome = (target: CoManagedSlaTargetDisplay, kind: 'response' | 'resolution') => <div className="space-y-1">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="text-sm">{t(`coManaged.slaDisplay.${kind}`)}</dt>
      <dd><Badge variant={target.status === 'breached' ? 'error' : target.status === 'completed' ? 'success' : 'secondary'}>
        {t(`coManaged.slaDisplay.status.${target.status}`)}
      </Badge></dd>
    </div>
    {(target.completedAt || target.dueAt) && <dd className="text-sm text-muted-foreground">
      {t(`coManaged.slaDisplay.${target.completedAt ? 'completedAt' : 'dueAt'}`)}{' '}
      <time dateTime={(target.completedAt || target.dueAt)!}>{formatDate(new Date((target.completedAt || target.dueAt)!), { dateStyle: 'medium', timeStyle: 'short' })}</time>
    </dd>}
  </div>;
  if (!sla.customer && !sla.msp) return null;
  return <section aria-label={t('coManaged.slaDisplay.title')} className="grid gap-3 sm:grid-cols-2">
    {(['customer', 'msp'] as const).map(side => {
      const value = sla[side];
      if (!value) return null;
      return <div key={side} className="space-y-3 rounded-md border p-3">
        <h2 className="font-semibold">{t('coManaged.slaDisplay.organization', { organization: side === 'customer' ? customerName : sponsorName })}</h2>
        {value.paused && <p className="text-sm text-muted-foreground">{t('coManaged.slaDisplay.status.paused')}</p>}
        {value.state !== 'tracking' ? <p className="text-sm text-muted-foreground">{t(`coManaged.slaDisplay.state.${value.state}`)}</p>
          : <dl className="space-y-3">{value.response && outcome(value.response, 'response')}{value.resolution && outcome(value.resolution, 'resolution')}</dl>}
      </div>;
    })}
  </section>;
}
