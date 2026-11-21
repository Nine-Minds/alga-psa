'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedSeatSetup from './CoManagedSeatSetup';
import { coManagedSeatMessage } from './coManagedSeatMessage';
import { readSeatAllocationIntent } from './seatAllocationIntent';

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
export default function CoManagedShapeChooser({ clientId, idPrefix, enable, workspaceSetup, purchaseOpen = false, onEnabled, onDirtyChange }: {
  clientId: string;
  idPrefix: string;
  enable: CoManagedSeatEnableView;
  /** The workspace flow, or null when the workspace shape is not offered for this client. */
  workspaceSetup: ReactNode | null;
  /** The pool purchase is offered: an empty pool no longer stops Seat, because setup reviews a purchase for the shortfall. */
  purchaseOpen?: boolean;
  onEnabled: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [choice, setChoice] = useState<'seat' | 'workspace' | null>(null);
  // A request left waiting on a purchase (a reload, a return from checkout) reopens Seat, where setup resumes it.
  useEffect(() => {
    if (purchaseOpen && readSeatAllocationIntent(clientId)) setChoice((current) => current ?? 'seat');
  }, [purchaseOpen, clientId]);
  // A pool with no seats left is only a blocker when it cannot be bought into; every other refusal still stops here.
  const blocker = enable.blocker === 'CAPACITY_UNAVAILABLE' && purchaseOpen ? null : enable.blocker;
  const { capacity } = enable;
  const options = [
    { shape: 'seat' as const, disabled: blocker !== null,
      label: t('coManaged.seat.chooser.seat', { defaultValue: 'Seat' }),
      hint: t('coManaged.seat.chooser.seatHint', { defaultValue: 'The client\'s technicians work in your PSA, limited to their company.' }) },
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
          <p id={`${idPrefix}-pool`} role="status" className="text-sm text-[rgb(var(--color-text-600))]">
            {t('coManaged.seat.chooser.pool', {
              defaultValue: '{{available}} of {{purchased}} seats available. {{allocated}} allocated.',
              available: capacity.available, purchased: capacity.purchased, allocated: capacity.allocated })}
          </p>
          {blocker && <Alert variant="destructive"><AlertDescription id={`${idPrefix}-blocker`}>{coManagedSeatMessage(blocker, t)}</AlertDescription></Alert>}
        </CardContent>
      </Card>
      {choice === 'seat' && !blocker && (
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
