'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import AsyncClientPicker from '@alga-psa/ui/components/AsyncClientPicker';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { currencyFractionDigits } from '@alga-psa/core/formatters';
import { coManagedSeatMessage } from '@/components/co-managed/coManagedSeatMessage';
import CoManagedSeatContactField from '@/components/co-managed/CoManagedSeatContactField';
import CoManagedSeatBoardPicker, { type SeatBoardChoice } from '@/components/co-managed/CoManagedSeatBoardPicker';
import CoManagedPurchaseReview from '@/components/co-managed/CoManagedPurchaseReview';
import { useCoManagedPurchaseController } from '@/components/co-managed/useCoManagedPurchaseController';
import { newCoManagedOperationId } from '@/components/co-managed/coManagedOperationId';
import { getCoManagedSeatAdminOptions } from '@/lib/actions/coManagedSeatActions';
import type { SeatTrialOffer } from '@/components/co-managed/useSeatTrialOffer';
import { prepareCoManagedSeatTrialAction, resumeCoManagedSeatTrialAction,
  replaceCoManagedSeatTrialTechnicianAction, cancelCoManagedSeatTrialAction, reviewSeatTrialConversionAction,
  purchaseSeatForTrialAction, applyPaidSeatToTrialAction, cancelSeatTrialConversionAction } from '../../lib/actions/coManagedSeatTrialActions';

type TrialError = 'boardChoicesFailed' | 'actionFailed';
type TrialNotice = 'invitationSent' | 'invitationSaved' | 'deliveryFailed' | 'replacementSent' | 'replacementSaved';
const cutoffFormat: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
};

const isRejected = (result: unknown): result is { rejected: true; errorCode: string } =>
  typeof result === 'object' && result !== null && 'rejected' in result;

/** Presentational: the offer is read once by `useSeatTrialOffer` (shared with the Enable chooser); this card never fetches it. */
export default function CoManagedSeatTrial({ offer, onReload, clientId, onChanged }: {
  offer: SeatTrialOffer | null; onReload: () => Promise<void>; clientId?: string; onChanged?: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatCurrency, formatDate } = useFormatters();
  const [error, setError] = useState<TrialError | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState('');
  const [scope, setScope] = useState<SeatBoardChoice>({});
  const [boards, setBoards] = useState<Array<{ boardId: string; name: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [useSpare, setUseSpare] = useState(false);
  const [notice, setNotice] = useState<TrialNotice | null>(null);
  const operation = useRef(newCoManagedOperationId());
  const pilot = offer?.pilot;
  const prefix = clientId ? 'client-seat-trial' : 'overview-seat-trial';
  useEffect(() => {
    if (!clientId || !offer?.canStart) return;
    let current = true;
    void getCoManagedSeatAdminOptions(clientId).then(next => { if (current) setBoards(next.boards); })
      .catch(() => { if (current) setError('boardChoicesFailed'); });
    return () => { current = false; };
  }, [clientId, offer?.canStart]);
  const controller = useCoManagedPurchaseController({
    confirm: async (input, quote) => {
      if (!pilot) throw new Error('Trial unavailable');
      return purchaseSeatForTrialAction({ trialId: pilot.trialId, ...input, quote });
    },
  });
  if (!offer) return null;
  const refresh = async () => { await onReload(); onChanged?.(); };
  // Same contract as CoManagedSeatPanel.run: a refusal the server names comes back as data and is
  // worded by coManagedSeatMessage; anything thrown is unknown and gets the generic message.
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null); setRejection(null);
    try {
      const result = await work();
      if (isRejected(result)) { setRejection(coManagedSeatMessage(result.errorCode, t, 'trial')); return; }
      await refresh();
    } catch { setError('actionFailed'); }
    finally { setBusy(false); }
  };
  const terms = offer.price && formatCurrency(
    offer.price.unitAmount / 10 ** currencyFractionDigits(offer.price.currency), offer.price.currency,
  );
  const target = offer.clientId ?? selected;
  return <Card id={prefix}>
    <CardHeader><CardTitle>{t('coManaged.trial.title')}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p>{t('coManaged.trial.description')}</p>
      {terms && <p>{t('coManaged.trial.terms', { amount: terms })}</p>}
      {pilot && <div role="status">
        <p>{t(`coManaged.trial.status.${pilot.status}`)}</p>
        {pilot.pendingPurchase && <p>{t('coManaged.trial.purchaseAwaitingVerification')}</p>}
        {pilot.conversionFailed && <p>{t('coManaged.trial.conversionFailed')}</p>}
        {pilot.deadline && <p>{t('coManaged.trial.deadline', { date: formatDate(pilot.deadline, cutoffFormat) })}</p>}
        {pilot.baseUntil && (!pilot.deadline || Date.parse(pilot.baseUntil) < Date.parse(pilot.deadline)) &&
          <p>{t('coManaged.trial.baseUntil', { date: formatDate(pilot.baseUntil, cutoffFormat) })}</p>}
      </div>}
      {!clientId && offer.canStart && <AsyncClientPicker id={prefix + '-client'} selectedClientId={selected} onSelect={setSelected} />}
      {!clientId && target && <Link id={prefix + '-setup'} href={'/msp/clients/' + encodeURIComponent(target) + '?tab=co-managed'}>{t('coManaged.trial.openSetup')}</Link>}
      {clientId && (offer.canStart || (pilot?.status === 'pending' && !pilot.pendingPurchase)) && <>
        {offer.canStart && <CoManagedSeatBoardPicker boards={boards} idPrefix={prefix} value={scope} onChange={setScope} />}
        {offer.intake && <CoManagedSeatContactField clientId={clientId} value={contact} onChange={setContact} idPrefix={prefix} />}
        {offer.canStart && <Button id={prefix + '-invite'} disabled={busy || !contact} onClick={() => void run(async () => {
          const result = await prepareCoManagedSeatTrialAction({ clientId, contactId: contact, operationId: operation.current,
            boards: Object.entries(scope).map(([boardId, entry]) => ({ boardId, canCreate: entry.canCreate })) });
          if (isRejected(result)) return result;
          setNotice(result.delivered ? 'invitationSent' : 'invitationSaved');
        })}>{t('coManaged.trial.invite')}</Button>}
        {(pilot?.status === 'pending' && !pilot.pendingPurchase) && <>
          {offer.intake && pilot.invited && <Button id={prefix + '-resend'} disabled={busy} onClick={() => void run(async () => {
            const result = await resumeCoManagedSeatTrialAction(pilot.trialId);
            if (isRejected(result)) return result;
            setNotice(result.delivered ? 'invitationSent' : 'deliveryFailed');
          })}>{t('coManaged.trial.resend')}</Button>}
          {offer.intake && <Button id={prefix + '-replace'} disabled={busy || !contact} onClick={() => void run(async () => {
            const result = await replaceCoManagedSeatTrialTechnicianAction({ trialId: pilot.trialId, contactId: contact });
            if (isRejected(result)) return result;
            setNotice(result.delivered ? 'replacementSent' : 'replacementSaved');
          })}>{t('coManaged.trial.replace')}</Button>}
          <Button id={prefix + '-cancel'} disabled={busy} onClick={() => void run(async () => {
            const result = await cancelCoManagedSeatTrialAction(pilot.trialId);
            if (isRejected(result)) return result;
            operation.current = newCoManagedOperationId();
          })}>{t('coManaged.trial.cancelInvitation')}</Button>
        </>}
      </>}
      {pilot && offer.canPurchase && (pilot.pendingPurchase || !['ended', 'paid'].includes(pilot.status)) && <>
        {(pilot.status === 'base_paused' || !pilot.baseUntil || Date.parse(pilot.baseUntil) <= Date.now()) && <Link id={prefix + '-account'} href={'/msp/account?seatTrialClient=' + encodeURIComponent(offer.clientId!)}>{t('coManaged.trial.restoreBase')}</Link>}
        {pilot.pendingPurchase ? <>
          <Button id={prefix + '-resume'} onClick={() => void run(() => controller.replay(pilot.pendingPurchase!.operationId, pilot.pendingPurchase!.quantity))}>{t('coManaged.trial.resumePurchase')}</Button>
          <Button id={prefix + '-cancel-purchase'} onClick={() => void run(() => cancelSeatTrialConversionAction(pilot.trialId))}>{t('coManaged.trial.cancelConversion')}</Button>
        </> : useSpare ? <>
          <p>{t('coManaged.trial.spareSeatTerms')}</p>
          <Button id={prefix + '-use-paid'} disabled={busy} onClick={() => void run(async () => { setUseSpare(false); await applyPaidSeatToTrialAction(pilot.trialId); })}>{t('coManaged.trial.confirmSpareSeat')}</Button>
        </> : <Button id={prefix + '-review'} disabled={busy} onClick={() => void run(async () => {
          const review = await reviewSeatTrialConversionAction(pilot.trialId);
          if (review.kind === 'spare') setUseSpare(true);
          else controller.startNewReview(review);
        })}>{t('coManaged.trial.keepSeat')}</Button>}
        <CoManagedPurchaseReview controller={controller} idPrefix={prefix} onConfirmed={refresh} />
      </>}
      {pilot && <Button id={prefix + '-refresh'} variant="outline" disabled={busy} onClick={() => void run(async () => {})}>{t('coManaged.trial.refresh')}</Button>}
      {notice && <p role="status">{notice === 'invitationSent' ? t('coManaged.seat.technicians.sent') : t(`coManaged.trial.notice.${notice}`)}</p>}
      {(error || rejection || controller.error) && <p role="alert">{rejection ?? (error ? t(`coManaged.trial.error.${error}`) : t('coManaged.trial.error.paymentFailed'))}</p>}
    </CardContent>
  </Card>;
}
