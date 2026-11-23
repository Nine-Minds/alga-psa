'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedSeatSetup from './CoManagedSeatSetup';
import { coManagedSeatMessage } from './coManagedSeatMessage';
import { readSeatAllocationIntent } from './seatAllocationIntent';
import { resolveSeatEnableStory, type SeatEnableStory } from '@/lib/co-managed/seatEnableStory';

export interface CoManagedSeatEnableView {
  capacity: { purchased: number; allocated: number; available: number };
  blocker: string | null;
}

/**
 * "Enable co-managed IT" for a client that has no arrangement: two shapes with one sentence each, the
 * pool's seats and any blocker. Workspace continues into the existing provisioning flow, rendered
 * unchanged by the caller; Seat opens the seat setup. When the pool purchase is offered, a pool with
 * too few seats continues into setup, which reviews a purchase for the shortfall; otherwise it shows the
 * blocker and stops.
 */
export default function CoManagedShapeChooser({ clientId, idPrefix, enable, workspaceSetup, purchaseOpen = false, story, trialEnds, onEnabled, onDirtyChange }: {
  clientId: string;
  idPrefix: string;
  enable: CoManagedSeatEnableView;
  /** The workspace flow, or null when the workspace shape is not offered for this client. */
  workspaceSetup: ReactNode | null;
  /** The pool purchase is offered: an empty pool no longer stops Seat, because setup reviews a purchase for the shortfall. */
  purchaseOpen?: boolean;
  /** The resolved Enable story (trial and pool together). Absent means no trial surface: the chooser as it was. */
  story?: SeatEnableStory;
  /** The running trial's end, already formatted, for the Seat hint. */
  trialEnds?: string;
  onEnabled: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [choice, setChoice] = useState<'seat' | 'workspace' | null>(null);
  // A request left waiting on a purchase (a reload, a return from checkout) reopens Seat, where setup resumes it.
  useEffect(() => {
    if (purchaseOpen && readSeatAllocationIntent(clientId)) setChoice((current) => current ?? 'seat');
  }, [purchaseOpen, clientId]);
  const resolved = story ?? resolveSeatEnableStory({ enable, trial: 'none', purchaseOpen, workspaceOffered: workspaceSetup !== null });
  const { blocker } = resolved;
  const { capacity } = enable;
  const seatHint = resolved.seatHint === 'trialCovers' && trialEnds
    ? t('coManaged.seat.chooser.seatHintTrialCovers', { defaultValue: 'The trial seat covers this technician until {{date}}. Buy a seat to keep them.', date: trialEnds })
    : resolved.seatHint !== 'default'
      ? t('coManaged.seat.chooser.seatHintAfterTrial', { defaultValue: 'Add co-managed seats to keep the technician after the 15-day trial.' })
      : t('coManaged.seat.chooser.seatHint', { defaultValue: 'The client\'s technicians work in your PSA, limited to their company.' });
  const notice = resolved.notice && resolved.notice !== 'none' ? {
    available: t('coManaged.seat.trial.available', { defaultValue: 'A free 15-day trial is available above. Co-managed seats can be added at any time.' }),
    pending: t('coManaged.seat.trial.pending', { defaultValue: 'A 15-day trial invitation is waiting for the technician. Co-managed seats can be added at any time.' }),
    active: t('coManaged.seat.trial.active', { defaultValue: 'The 15-day trial is running. Add co-managed seats to keep the technician afterwards.' }),
    ended: t('coManaged.seat.trial.ended', { defaultValue: 'The 15-day trial has ended. Add co-managed seats to keep the technician.' }),
  }[resolved.notice] : null;
  const options = [
    { shape: 'seat' as const, disabled: resolved.seatDisabled,
      label: t('coManaged.seat.chooser.seat', { defaultValue: 'Seat' }),
      hint: seatHint },
    ...(workspaceSetup ? [{ shape: 'workspace' as const, disabled: false,
      label: t('coManaged.seat.chooser.workspace', { defaultValue: 'Workspace' }),
      hint: t('coManaged.seat.chooser.workspaceHint', { defaultValue: 'The client\'s IT team gets its own service desk and escalates to you.' }) }] : []),
  ];

  return (
    <div className="space-y-4">
      <Card id={`${idPrefix}-chooser`} aria-labelledby={`${idPrefix}-chooser-title`}>
        <CardHeader>
          <CardTitle id={`${idPrefix}-chooser-title`}>{t('coManaged.provisioning.create', { defaultValue: 'Enable co-managed IT' })}</CardTitle>
          <CardDescription>{t('coManaged.seat.chooser.description', { defaultValue: 'Choose how this client\'s IT team works with you.' })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="radiogroup" aria-label={t('coManaged.seat.chooser.shape', { defaultValue: 'Co-managed shape' })} className="grid gap-3 sm:grid-cols-2">
            {options.map((option) => (
              <button key={option.shape} id={`${idPrefix}-choose-${option.shape}`} type="button" role="radio"
                aria-checked={choice === option.shape} disabled={option.disabled} onClick={() => setChoice(option.shape)}
                className={`rounded-md border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${choice === option.shape
                  ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))]' : 'border-[rgb(var(--color-border-200))] hover:border-[rgb(var(--color-primary-300))]'}`}>
                <span className="block font-semibold">{option.label}</span>
                <span className="mt-1 block text-sm text-[rgb(var(--color-text-600))]">{option.hint}</span>
              </button>
            ))}
          </div>
          {notice && <Alert variant="info" role="status"><AlertDescription id={`${idPrefix}-trial-notice`}>{notice}</AlertDescription></Alert>}
          {resolved.pool !== 'hidden' && <p id={`${idPrefix}-pool`} role="status" className="text-sm text-[rgb(var(--color-text-600))]">
            {resolved.pool === 'empty'
              ? t('coManaged.seat.chooser.poolEmpty', { defaultValue: 'No co-managed seats yet.' })
              : t('coManaged.seat.chooser.pool', {
                defaultValue: '{{available}} of {{purchased}} seats available. {{allocated}} allocated.',
                available: capacity.available, purchased: capacity.purchased, allocated: capacity.allocated })}
          </p>}
          {blocker && <Alert variant="destructive"><AlertDescription id={`${idPrefix}-blocker`}>{coManagedSeatMessage(blocker, t)}</AlertDescription></Alert>}
        </CardContent>
      </Card>
      {choice === 'seat' && !resolved.seatDisabled && (
        <Card id={`${idPrefix}-seat-card`}>
          <CardHeader><CardTitle>{t('coManaged.seat.setup.title', { defaultValue: 'Seat arrangement' })}</CardTitle></CardHeader>
          <CardContent>
            <CoManagedSeatSetup clientId={clientId} idPrefix={idPrefix} available={capacity.available} purchaseOpen={purchaseOpen}
              onEnabled={onEnabled} onDirtyChange={onDirtyChange} />
          </CardContent>
        </Card>
      )}
      {choice === 'workspace' && workspaceSetup}
    </div>
  );
}
