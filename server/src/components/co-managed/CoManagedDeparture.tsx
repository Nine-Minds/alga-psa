'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedDeparture, departFromCoManagedRelationship, type CoManagedDepartureResult, type CoManagedDepartResult } from '@/lib/actions/coManagedDepartureActions';

type Review = Extract<CoManagedDepartureResult, { ok: true }>['review'];

/**
 * Ending a relationship, from either side. The review is advisory: outstanding handoffs and seats are
 * shown as a warning and never block, because blocking on another party's inaction would trap the
 * party that is leaving. The retry key is minted once per confirmation so a double click or a retried
 * request replays the same closure instead of attempting a second one.
 */
export default function CoManagedDeparture({ clientId, relationshipId }: { clientId?: string; relationshipId?: string }) {
  const { t, i18n } = useTranslation('msp/co-managed-lifecycle');
  const { formatDate } = useFormatters();
  const [review, setReview] = useState<Review | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ releasedSeats: number } | null>(null);
  const operationId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const result = await getCoManagedDeparture({ clientId, relationshipId });
    if (result.ok) { setReview(result.review); setRefusal(null); }
    else setRefusal(result.reason === 'not_found' ? t('departure.errors.notFound', { defaultValue: 'This relationship could not be found.' })
      : t('departure.errors.denied', { defaultValue: 'You do not have permission to end this relationship.' }));
  }, [clientId, relationshipId, t]);
  useEffect(() => { void load(); }, [load]);

  const reason = (result: Extract<CoManagedDepartResult, { ok: false }>) => ({
    denied: t('departure.errors.denied', { defaultValue: 'You do not have permission to end this relationship.' }),
    changed: t('departure.errors.changed', { defaultValue: 'The relationship changed while you were reviewing it. Review it again before ending it.' }),
    already_closed: t('departure.errors.alreadyClosed', { defaultValue: 'This relationship has already ended.' }),
    invalid: t('departure.errors.invalid', { defaultValue: 'The request could not be processed.' }),
  }[result.reason]);

  const confirm = async () => {
    if (!review) return;
    setBusy(true);
    operationId.current ??= crypto.randomUUID();
    try {
      const result = await departFromCoManagedRelationship({ clientId, relationshipId: review.relationshipId, expectedRevision: review.revision, operationId: operationId.current });
      if (result.ok) {
        // A sponsor can no longer read the ended relationship (`not_found`), so reloading would show an error beside the
        // stale review. Render the ended state from the action result instead.
        setDone({ releasedSeats: result.releasedSeats });
        setRefusal(null);
        setReview(current => current && { ...current, departed: true, closedAt: result.closedAt, counterpartName: null, outstandingHandoffs: 0, seatsToRelease: 0 });
      }
      else { setRefusal(reason(result)); if (result.reason !== 'denied') operationId.current = null; }
    } catch {
      setRefusal(t('departure.errors.invalid', { defaultValue: 'The request could not be processed.' }));
      operationId.current = null;
    } finally { setBusy(false); setConfirming(false); }
  };

  const date = (value: string) => formatDate(new Date(value), { dateStyle: 'medium' });
  const side = review?.side;
  return <div id="co-managed-departure" className="space-y-4">
    {refusal && <Alert variant="destructive"><AlertDescription id="co-managed-departure-message">{refusal}</AlertDescription></Alert>}
    {!review && !refusal && <p role="status">{t('departure.loading', { defaultValue: 'Loading…' })}</p>}
    {done && <Alert><AlertDescription id="co-managed-departure-done">{t('departure.done', { defaultValue: 'The relationship has ended. Shared work history is retained and read-only.' })}</AlertDescription></Alert>}
    {review && <Card><CardContent className="space-y-4 pt-6">
      {review.departed
        ? <p id="co-managed-departure-ended" role="status" className="font-medium">
            {t('departure.endedOn', { defaultValue: 'This relationship ended {{date}}.', date: review.closedAt ? date(review.closedAt) : '' })}</p>
        : <>
            <h2 className="text-lg font-semibold">{side === 'customer'
              ? t('departure.titleCustomer', { defaultValue: 'End co-managed IT with {{name}}', name: review.counterpartName ?? '' })
              : t('departure.titleSponsor', { defaultValue: 'End co-managed IT for {{name}}', name: review.counterpartName ?? '' })}</h2>
            <p className="text-sm">{side === 'customer'
              ? t('departure.keepCustomer', { defaultValue: 'You keep your workspace, tickets, users and files. Your MSP loses access immediately and keeps only a record of the work it took part in.' })
              : t('departure.keepSponsor', { defaultValue: 'You keep a read-only archive of the work you took part in. Your access to the customer workspace ends immediately and the seats return to your pool.' })}</p>
            {review.outstandingHandoffs > 0 && <Alert><AlertDescription id="co-managed-departure-handoffs">
              {t('departure.warnHandoffs', { count: review.outstandingHandoffs, defaultValue_one: '{{count}} shared ticket is still with the MSP. It will stay open and the MSP will lose access to it.', defaultValue_other: '{{count}} shared tickets are still with the MSP. They will stay open and the MSP will lose access to them.' })}
            </AlertDescription></Alert>}
            {side === 'sponsor' && review.seatsToRelease > 0 && <p id="co-managed-departure-seats" className="text-sm">
              {t('departure.seats', { count: review.seatsToRelease, defaultValue_one: '{{count}} seat will be released.', defaultValue_other: '{{count}} seats will be released.' })}</p>}
            <Button id="co-managed-departure-start" variant="destructive" disabled={busy} onClick={() => { setRefusal(null); setConfirming(true); }}>
              {t('departure.end', { defaultValue: 'End relationship' })}</Button>
          </>}
    </CardContent></Card>}
    <ConfirmationDialog id="co-managed-departure-confirm" isOpen={confirming} onClose={() => setConfirming(false)} onConfirm={confirm} isConfirming={busy}
      title={t('departure.confirmTitle', { defaultValue: 'End this relationship?' })}
      message={t('departure.confirmMessage', { defaultValue: 'This cannot be undone from here. Access ends immediately for both sides.' })}
      confirmLabel={t('departure.confirmEnd', { defaultValue: 'End relationship' })} cancelLabel={t('departure.cancel', { defaultValue: 'Cancel' })} />
  </div>;
}
