'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import AsyncClientPicker from '@alga-psa/ui/components/AsyncClientPicker';
import { currencyFractionDigits } from '@alga-psa/core/formatters';
import CoManagedSeatContactField from '@/components/co-managed/CoManagedSeatContactField';
import CoManagedSeatBoardPicker, { type SeatBoardChoice } from '@/components/co-managed/CoManagedSeatBoardPicker';
import CoManagedPurchaseReview from '@/components/co-managed/CoManagedPurchaseReview';
import { useCoManagedPurchaseController } from '@/components/co-managed/useCoManagedPurchaseController';
import { newCoManagedOperationId } from '@/components/co-managed/coManagedOperationId';
import { getCoManagedSeatAdminOptions } from '@/lib/actions/coManagedSeatActions';
import { getSeatTrialOfferAction, prepareCoManagedSeatTrialAction, resumeCoManagedSeatTrialAction,
  replaceCoManagedSeatTrialTechnicianAction, cancelCoManagedSeatTrialAction, reviewSeatTrialConversionAction,
  purchaseSeatForTrialAction, usePaidSeatForTrialAction, cancelSeatTrialConversionAction } from '../../lib/actions/coManagedSeatTrialActions';

const labels = { active: 'Active', pending: 'Waiting for first sign-in', base_paused: 'Base subscription paused',
  expired: 'Trial expired', paid: 'Using a paid seat', ended: 'Trial ended', checkout_pending: 'Awaiting payment' };
type Offer = Awaited<ReturnType<typeof getSeatTrialOfferAction>>;

export default function CoManagedSeatTrial({ clientId, onChanged }: { clientId?: string; onChanged?: () => void }) {
  const [offer, setOffer] = useState<Offer>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState('');
  const [scope, setScope] = useState<SeatBoardChoice>({});
  const [boards, setBoards] = useState<Array<{ boardId: string; name: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [useSpare, setUseSpare] = useState(false);
  const [notice, setNotice] = useState('');
  const operation = useRef(newCoManagedOperationId());
  const pilot = offer?.pilot;
  const prefix = clientId ? 'client-seat-trial' : 'overview-seat-trial';
  const load = useCallback(() => getSeatTrialOfferAction(clientId), [clientId]);
  useEffect(() => {
    let current = true;
    setOffer(null);
    void load().then(next => { if (current) setOffer(next); }).catch(() => { if (current) setOffer(null); });
    return () => { current = false; };
  }, [load]);
  useEffect(() => {
    if (!clientId || !offer?.canStart) return;
    let current = true;
    void getCoManagedSeatAdminOptions(clientId).then(next => { if (current) setBoards(next.boards); })
      .catch(() => { if (current) setError('Board choices could not be loaded.'); });
    return () => { current = false; };
  }, [clientId, offer?.canStart]);
  const controller = useCoManagedPurchaseController({
    confirm: async (input, quote) => {
      if (!pilot) throw new Error('Trial unavailable');
      return purchaseSeatForTrialAction({ trialId: pilot.trialId, ...input, quote });
    },
  });
  if (!offer) return null;
  const refresh = async () => { setOffer(await load()); onChanged?.(); };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); } catch { setError('Could not complete this action. Refresh the trial and try again.'); }
    finally { setBusy(false); }
  };
  const terms = offer.price && new Intl.NumberFormat(undefined, { style: 'currency', currency: offer.price.currency })
    .format(offer.price.unitAmount / 10 ** currencyFractionDigits(offer.price.currency));
  const target = offer.clientId ?? selected;
  return <Card id={prefix}>
    <CardHeader><CardTitle>15-day co-managed Seat trial</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p>Invite one client technician to work on the boards you choose. The 15 days start at their first sign-in. Access requires an active base subscription or base trial.</p>
      {terms && <p>A paid seat costs {terms} per month. The trial ends without a charge unless you confirm paid capacity.</p>}
      {pilot && <div role="status">
        <p>{labels[pilot.status]}{pilot.pendingPurchase && ' · Purchase awaiting verification'}</p>
        {pilot.conversionFailed && <p>The seat conversion did not complete. Review available paid capacity or try checkout again.</p>}
        {pilot.deadline && <p>Seat trial ends {new Date(pilot.deadline).toLocaleString()}.</p>}
        {pilot.baseUntil && (!pilot.deadline || Date.parse(pilot.baseUntil) < Date.parse(pilot.deadline)) &&
          <p>Current base access ends {new Date(pilot.baseUntil).toLocaleString()}.</p>}
      </div>}
      {!clientId && offer.canStart && <AsyncClientPicker id={prefix + '-client'} selectedClientId={selected} onSelect={setSelected} />}
      {!clientId && target && <Link id={prefix + '-setup'} href={'/msp/clients/' + encodeURIComponent(target) + '?tab=co-managed'}>Open client Seat setup</Link>}
      {clientId && (offer.canStart || (pilot?.status === 'pending' && !pilot.pendingPurchase)) && <>
        {offer.canStart && <CoManagedSeatBoardPicker boards={boards} idPrefix={prefix} value={scope} onChange={setScope} />}
        {offer.intake && <CoManagedSeatContactField clientId={clientId} value={contact} onChange={setContact} idPrefix={prefix} />}
        {offer.canStart && <Button id={prefix + '-invite'} disabled={busy || !contact} onClick={() => void run(async () => {
          const result = await prepareCoManagedSeatTrialAction({ clientId, contactId: contact, operationId: operation.current,
            boards: Object.entries(scope).map(([boardId, entry]) => ({ boardId, canCreate: entry.canCreate })) });
          setNotice(result.delivered ? 'Invitation sent.' : 'Invitation saved. Retry delivery below.');
        })}>Invite technician for 15 days</Button>}
        {(pilot?.status === 'pending' && !pilot.pendingPurchase) && <>
          {offer.intake && pilot.invited && <Button id={prefix + '-resend'} disabled={busy} onClick={() => void run(async () => {
            const result = await resumeCoManagedSeatTrialAction(pilot.trialId);
            setNotice(result.delivered ? 'Invitation sent.' : 'Delivery failed. You can retry.');
          })}>Resend invitation</Button>}
          {offer.intake && <Button id={prefix + '-replace'} disabled={busy || !contact} onClick={() => void run(async () => {
            const result = await replaceCoManagedSeatTrialTechnicianAction({ trialId: pilot.trialId, contactId: contact });
            setNotice(result.delivered ? 'Replacement invitation sent.' : 'Replacement saved. Retry delivery.');
          })}>Replace technician</Button>}
          <Button id={prefix + '-cancel'} disabled={busy} onClick={() => void run(async () => {
            await cancelCoManagedSeatTrialAction(pilot.trialId); operation.current = newCoManagedOperationId();
          })}>Cancel invitation</Button>
        </>}
      </>}
      {pilot && offer.canPurchase && (pilot.pendingPurchase || !['ended', 'paid'].includes(pilot.status)) && <>
        {(pilot.status === 'base_paused' || !pilot.baseUntil || Date.parse(pilot.baseUntil) <= Date.now()) && <Link id={prefix + '-account'} href={'/msp/account?seatTrialClient=' + encodeURIComponent(offer.clientId!)}>Restore base access in Account</Link>}
        {pilot.pendingPurchase ? <>
          <Button id={prefix + '-resume'} onClick={() => void run(() => controller.replay(pilot.pendingPurchase!.operationId, pilot.pendingPurchase!.quantity))}>Resume purchase</Button>
          <Button id={prefix + '-cancel-purchase'} onClick={() => void run(() => cancelSeatTrialConversionAction(pilot.trialId))}>Cancel seat conversion</Button>
        </> : useSpare ? <>
          <p>Use one available paid seat now. Your recurring pool total stays the same.</p>
          <Button id={prefix + '-use-paid'} disabled={busy} onClick={() => void run(async () => { setUseSpare(false); await usePaidSeatForTrialAction(pilot.trialId); })}>Confirm use of one paid seat</Button>
        </> : <Button id={prefix + '-review'} disabled={busy} onClick={() => void run(async () => {
          const review = await reviewSeatTrialConversionAction(pilot.trialId);
          if (review.kind === 'spare') setUseSpare(true);
          else controller.startNewReview(review);
        })}>Keep this seat</Button>}
        <CoManagedPurchaseReview controller={controller} idPrefix={prefix} onConfirmed={refresh} />
      </>}
      {pilot && <Button id={prefix + '-refresh'} variant="outline" disabled={busy} onClick={() => void run(async () => {})}>Refresh trial</Button>}
      {notice && <p role="status">{notice}</p>}
      {(error || controller.error) && <p role="alert">{error || 'Payment could not be completed. Review the trial status.'}</p>}
    </CardContent>
  </Card>;
}
