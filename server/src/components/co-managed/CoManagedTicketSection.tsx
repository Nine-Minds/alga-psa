'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Handshake, History } from 'lucide-react';
import type { CoManagedSlaTargetDisplay, CoManagedTicketSlaDisplay } from '@alga-psa/co-managed';
import { BentoTile } from '@alga-psa/ui/components/bento/BentoTile';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedTicketScreenAction, type CoManagedTicketScreenTarget } from '@/lib/actions/coManagedSharedWorkActions';
import CoManagedAssignmentField from './CoManagedAssignmentField';
import CoManagedHandoffDialog, { type HandoffAction } from './CoManagedHandoffDialog';
import CoManagedHandoffHistoryDrawer from './CoManagedHandoffHistoryDrawer';

type Screen = Awaited<ReturnType<typeof getCoManagedTicketScreenAction>>;

const STATUS_TEXT: Record<CoManagedSlaTargetDisplay['status'], string> = {
  running: 'text-amber-700 dark:text-amber-400',
  paused: 'text-[rgb(var(--color-text-500))]',
  breached: 'text-red-700 dark:text-red-400',
  completed: 'text-green-700 dark:text-green-400',
  not_configured: 'text-[rgb(var(--color-text-400))]',
  not_recorded: 'text-[rgb(var(--color-text-400))]',
};

/**
 * Co-managed content for the native ticket screen. Entry layout renders it in
 * the properties column, Grid layout as a bento tile; both use the same tile
 * surface, so the two layouts read as one product.
 *
 * `local` = the owner's own ticket (customer side), `shared` = the sponsor
 * (MSP) viewing a customer's ticket. The component keys itself by the
 * qualified identity so navigation can never paint a previous ticket's state.
 */
export default function CoManagedTicketSection({ target, onChanged, layout = 'entry' }: {
  target: CoManagedTicketScreenTarget; onChanged?: () => void; layout?: 'entry' | 'grid';
}) {
  const identity = target.kind === 'local' ? `local:${target.ticketId}` : JSON.stringify(target.resource);
  return <Section key={identity} target={target} onChanged={onChanged} layout={layout} />;
}

function Section({ target, onChanged, layout }: { target: CoManagedTicketScreenTarget; onChanged?: () => void; layout: 'entry' | 'grid' }) {
  const { t } = useTranslation('msp/licensing');
  const initialTarget = useRef(target);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [screen, setScreen] = useState<Screen | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [action, setAction] = useState<HandoffAction | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // LEVERAGE: pattern co-managed-request-generation — keep late reads out of a refreshed or unavailable section.
  const generation = useRef(0);

  // One reload path for every failure: drop the screen and read again.
  const reload = useCallback(() => {
    generation.current++; setScreen(null); setError(false); setAction(null); setRefresh(value => value + 1);
  }, []);
  const unavailable = useCallback(() => {
    generation.current++; setScreen(null); setAction(null); setHistoryOpen(false); setError(true);
  }, []);
  // A write landed: re-read the section and let the screen around it refresh too.
  const saved = useCallback(() => { reload(); changed.current?.(); }, [reload]);

  useEffect(() => {
    const current = ++generation.current;
    void getCoManagedTicketScreenAction(initialTarget.current).then(result => {
      if (generation.current === current) setScreen(result);
    }).catch(() => { if (generation.current === current) setError(true); });
    return () => { generation.current++; };
  }, [refresh]);

  const tileId = `co-managed-section-${layout}`;
  const title = t('coManaged.section.title');
  if (error) return <BentoTile id={tileId} title={title} icon={<Handshake className="h-4 w-4" />}>
    <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
      <p>{t('coManaged.ticket.loadError')}</p>
      <Button id="co-ticket-reload" variant="outline" size="sm" onClick={reload}>{t('coManaged.ticket.reload')}</Button>
    </div>
  </BentoTile>;
  if (!screen) return <BentoTile id={tileId} title={title} icon={<Handshake className="h-4 w-4" />}>
    <div id="co-ticket-loading" role="status" aria-label={t('coManaged.ticket.loading')} className="h-16 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />
  </BentoTile>;

  const fields = screen.summary.fields;
  const resource = screen.summary.resource;
  // After the relationship ends the screen no longer carries the former sponsor's name.
  const sponsorName = screen.sponsorName ?? t('coManaged.ticket.formerSponsor');
  const responsible = fields.responsibility === 'msp' ? sponsorName : fields.responsibility === 'customer' ? screen.customerName : null;
  const revision = typeof fields.work_revision === 'number' ? fields.work_revision : null;
  const canAct = screen.canWrite && revision !== null;

  return <BentoTile id={tileId} title={title} icon={<Handshake className="h-4 w-4" />}
    action={<Button id="co-ticket-history-open" type="button" variant="ghost" size="xs" className="h-6 w-6 p-0"
      aria-label={t('coManaged.section.viewHistory')} title={t('coManaged.section.viewHistory')} onClick={() => setHistoryOpen(true)}>
      <History className="h-4 w-4" /></Button>}>
    <div className="space-y-3">
      {responsible && <div id="co-ticket-responsibility" className="flex items-center justify-between gap-2 text-sm">
        <span className="flex-shrink-0 text-[rgb(var(--color-text-500))]">{t('coManaged.section.responsible')}</span>
        <span className="min-w-0 truncate font-medium text-[rgb(var(--color-text-800))]" title={responsible}>{responsible}</span>
      </div>}
      {!screen.canWrite && <p id="co-ticket-read-only" role="status" className="rounded-md border border-[rgb(var(--color-border-200))] px-3 py-2 text-xs text-[rgb(var(--color-text-500))]">{t('coManaged.ticket.readOnly')}</p>}
      {screen.sla && <SlaClocks sla={screen.sla} customerName={screen.customerName} sponsorName={sponsorName} />}
      <CoManagedAssignmentField resource={resource} refreshKey={refresh} onSaved={saved} onUnavailable={unavailable} />
      {canAct && (screen.canEscalate || screen.canHandBack || screen.canRevoke) && <div id="co-ticket-handoff-actions" className="flex flex-wrap gap-2">
        {screen.canEscalate && <Button id="co-ticket-escalate" size="sm" onClick={() => setAction('escalate')}>{t('coManaged.ticket.escalate')}</Button>}
        {screen.canHandBack && <Button id="co-ticket-handback" size="sm" onClick={() => setAction('handback')}>{t(`coManaged.ticket.${screen.side === 'customer' ? 'takeBack' : 'handback'}`)}</Button>}
        {screen.canRevoke && <Button id="co-ticket-revoke" size="sm" variant="outline" onClick={() => setAction('revoke')}>{t('coManaged.ticket.revoke')}</Button>}
      </div>}
    </div>
    {action && revision !== null && <CoManagedHandoffDialog key={action} action={action} side={screen.side} resource={resource} revision={revision}
      onSaved={saved} onClose={() => setAction(null)} onReload={reload} />}
    <CoManagedHandoffHistoryDrawer resource={resource} isOpen={historyOpen} onClose={() => setHistoryOpen(false)} refreshKey={refresh} />
  </BentoTile>;
}

function SlaClocks({ sla, customerName, sponsorName }: { sla: CoManagedTicketSlaDisplay; customerName: string; sponsorName: string }) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  if (!sla.customer && !sla.msp) return null;
  const row = (side: 'customer' | 'msp', kind: 'response' | 'resolution', target: CoManagedSlaTargetDisplay) => {
    const at = target.completedAt || target.dueAt;
    return <div key={kind} id={`co-ticket-sla-${side}-${kind}`} className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2 text-xs font-medium">
        <span className="text-[rgb(var(--color-text-600))]">{t(`coManaged.slaDisplay.${kind}`)}</span>
        <span className={STATUS_TEXT[target.status]}>{t(`coManaged.slaDisplay.status.${target.status}`)}</span>
      </div>
      {at && <p className="text-xs text-[rgb(var(--color-text-500))]">
        {t(`coManaged.slaDisplay.${target.completedAt ? 'completedAt' : 'dueAt'}`)}{' · '}
        <time dateTime={at}>{formatDate(new Date(at), { dateStyle: 'medium', timeStyle: 'short' })}</time></p>}
    </div>;
  };
  return <div id="co-ticket-sla" role="group" aria-label={t('coManaged.slaDisplay.title')} className="space-y-3">
    {(['customer', 'msp'] as const).map(side => {
      const value = sla[side];
      if (!value) return null;
      return <div key={side} id={`co-ticket-sla-${side}`} className="space-y-1.5">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]">
          {t('coManaged.slaDisplay.organization', { organization: side === 'customer' ? customerName : sponsorName })}</p>
        {value.paused && <p className="text-xs text-[rgb(var(--color-text-500))]">{t('coManaged.slaDisplay.status.paused')}</p>}
        {value.state !== 'tracking' ? <p className="text-xs text-[rgb(var(--color-text-500))]">{t(`coManaged.slaDisplay.state.${value.state}`)}</p>
          : <div className="space-y-2">{value.response && row(side, 'response', value.response)}{value.resolution && row(side, 'resolution', value.resolution)}</div>}
      </div>;
    })}
  </div>;
}
