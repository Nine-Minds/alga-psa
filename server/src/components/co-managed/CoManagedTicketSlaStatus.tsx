'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedSharedResource, CoManagedSlaDisplay, CoManagedSlaTargetDisplay, CoManagedTicketSlaDisplay } from '@alga-psa/co-managed';
import { getSharedTicketSlaAction } from '@/lib/actions/coManagedSharedWorkActions';

type OverallState = 'running' | 'paused' | 'met' | 'breached';
const variants: Record<OverallState, BadgeVariant> = { running: 'info', paused: 'warning', met: 'success', breached: 'error' };

/** One state for the whole obligation: a breach wins, then completion, then pause. */
function overall(display: CoManagedSlaDisplay): OverallState {
  const targets = [display.response, display.resolution].filter((target): target is CoManagedSlaTargetDisplay => Boolean(target));
  if (targets.some(target => target.status === 'breached')) return 'breached';
  if (display.resolution?.status === 'completed') return 'met';
  return display.paused ? 'paused' : 'running';
}

/**
 * The organization SLA on a shared ticket: whether the clock is running, paused, met or breached, how much
 * time has elapsed and when each target is due. The server action decides what the viewer may see; this only
 * renders it. With no obligation yet (nothing escalated) it says so rather than showing an empty card.
 */
export default function CoManagedTicketSlaStatus({ resource }: { resource: CoManagedSharedResource }) {
  const { t } = useTranslation('features/tickets');
  const { formatDate } = useFormatters();
  const [display, setDisplay] = useState<CoManagedTicketSlaDisplay | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getSharedTicketSlaAction(resource).then(
      result => { if (current) setDisplay(result); },
      () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [resource]);

  if (failed) {
    return <Alert id="co-managed-ticket-sla-error" variant="destructive"><AlertDescription>{t('sharedSla.loadError', 'The service level could not be loaded.')}</AlertDescription></Alert>;
  }
  if (!display) return null;

  const duration = (minutes: number) => minutes >= 60
    ? t('sharedSla.duration.hoursMinutes', { defaultValue: '{{hours}}h {{minutes}}m', hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t('sharedSla.duration.minutes', { defaultValue: '{{minutes}}m', minutes });
  const when = (iso: string) => formatDate(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const target = (id: string, kind: 'response' | 'resolution', value: CoManagedSlaTargetDisplay | undefined) => value && (
    <li key={kind} id={`${id}-${kind}`} className="flex items-center justify-between gap-3 text-sm">
      <span>{t(`sharedSla.target.${kind}`, kind === 'response' ? 'First response' : 'Resolution')}</span>
      <span className="text-[rgb(var(--color-text-600))]">
        {value.status === 'completed' && value.completedAt ? t('sharedSla.completedAt', { defaultValue: 'Met {{date}}', date: when(value.completedAt) })
          : value.status === 'breached' ? t('sharedSla.breached', 'Breached')
          : value.status === 'paused' ? t('sharedSla.targetPaused', 'Paused')
          : value.status === 'running' && value.dueAt ? t('sharedSla.dueAt', { defaultValue: 'Due {{date}}', date: when(value.dueAt) })
          : t('sharedSla.noTarget', 'No target')}
      </span>
    </li>
  );

  const block = (id: string, title: string, value: CoManagedSlaDisplay | undefined) => {
    if (!value) return null;
    return (
      <section id={id} aria-label={title} className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          {value.state === 'tracking' && <Badge id={`${id}-state`} variant={variants[overall(value)]}>{t(`sharedSla.state.${overall(value)}`, overall(value))}</Badge>}
        </div>
        {value.state === 'tracking' ? (
          <>
            {value.elapsedMinutes !== undefined && (
              <p id={`${id}-elapsed`} className="text-sm text-[rgb(var(--color-text-600))]">{t('sharedSla.elapsed', { defaultValue: 'Elapsed {{time}}', time: duration(value.elapsedMinutes) })}</p>
            )}
            <ul className="space-y-1">{target(id, 'response', value.response)}{target(id, 'resolution', value.resolution)}</ul>
          </>
        ) : (
          <p id={`${id}-note`} className="text-sm text-[rgb(var(--color-text-600))]">
            {value.state === 'not_started' ? t('sharedSla.notStarted', 'The clock starts when the ticket is escalated.')
              : value.state === 'unavailable' ? t('sharedSla.unavailable', 'This service level is no longer available.')
              : t('sharedSla.notConfigured', 'No service level applies.')}
          </p>
        )}
      </section>
    );
  };

  // Nothing started on either side: one empty state instead of two empty cards.
  const empty = (!display.msp || display.msp.state === 'not_started') && (!display.customer || display.customer.state === 'not_configured');
  return (
    <Card id="co-managed-ticket-sla" className="m-4">
      <CardHeader><CardTitle>{t('sharedSla.title', 'Service level')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {empty
          ? <p id="co-managed-ticket-sla-empty" className="text-sm text-[rgb(var(--color-text-600))]">{t('sharedSla.empty', 'No service level is being tracked for this ticket yet.')}</p>
          : <>
              {block('co-managed-ticket-sla-msp', t('sharedSla.msp', 'MSP service level'), display.msp)}
              {block('co-managed-ticket-sla-customer', t('sharedSla.customer', 'Customer service level'), display.customer)}
            </>}
      </CardContent>
    </Card>
  );
}
