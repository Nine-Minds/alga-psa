'use client';

import { useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useCapability } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  endCoManagedSeatArrangementAction, getCoManagedSeatArrangementEndPreview, type CoManagedSeatEndPreviewResult,
} from '@/lib/actions/coManagedSeatActions';

type Preview = Extract<CoManagedSeatEndPreviewResult, { ok: true }>['preview'];

/**
 * Ends a seat arrangement after a confirmation that lists its effects. Standalone: the arrangement
 * panel that will host it is a later slice, so nothing mounts this yet. It renders nothing unless the
 * `co-managed-seat` capability admits the tenant, and every action behind it checks the same gate.
 * Replaying the end is safe, so a double click or a retry needs no key of its own.
 */
export default function CoManagedSeatArrangementEnd({ arrangementId, onEnded }: { arrangementId: string; onEnded?: () => void }) {
  const { t } = useTranslation('msp/co-managed-lifecycle');
  const { admitted } = useCapability('co-managed-seat');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!admitted) return null;

  const refusal = (reason: 'denied' | 'not_found') => reason === 'denied'
    ? t('seatEnd.errorDenied', { defaultValue: 'You do not have permission to end this arrangement.' })
    : t('seatEnd.errorNotFound', { defaultValue: 'This arrangement could not be found.' });
  const failed = () => t('seatEnd.errorGeneric', { defaultValue: 'The request could not be processed.' });

  const review = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await getCoManagedSeatArrangementEndPreview({ arrangementId });
      if (result.ok) setPreview(result.preview); else setMessage(refusal(result.reason));
    } catch { setMessage(failed()); } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await endCoManagedSeatArrangementAction({ arrangementId });
      if (result.ok) { setDone(true); setMessage(null); onEnded?.(); } else setMessage(refusal(result.reason));
    } catch { setMessage(failed()); } finally { setBusy(false); setPreview(null); }
  };

  return <div id="co-managed-seat-end" className="space-y-3">
    {message && <Alert variant="destructive"><AlertDescription id="co-managed-seat-end-message">{message}</AlertDescription></Alert>}
    {done
      ? <Alert><AlertDescription id="co-managed-seat-end-done">{t('seatEnd.done', { defaultValue: 'The seat arrangement has ended.' })}</AlertDescription></Alert>
      : <Button id="co-managed-seat-end-start" variant="destructive" disabled={busy} onClick={review}>
          {t('seatEnd.start', { defaultValue: 'End seat arrangement' })}</Button>}
    <ConfirmationDialog id="co-managed-seat-end-confirm" isOpen={preview !== null} onClose={() => setPreview(null)} onConfirm={confirm} isConfirming={busy}
      title={t('seatEnd.title', { defaultValue: 'End the seat arrangement for {{name}}?', name: preview?.clientName ?? '' })}
      message={preview && <div className="space-y-2 text-sm">
        <p>{t('seatEnd.intro', { defaultValue: "Ending takes effect on each technician's next request and cannot be undone from here." })}</p>
        <ul className="list-disc pl-5">
          <li>{t('seatEnd.effectTechnicians', { count: preview.technicians, defaultValue: 'Technicians deactivated: {{count}}' })}</li>
          <li>{t('seatEnd.effectInvitations', { count: preview.pendingInvitations, defaultValue: 'Pending invitations withdrawn: {{count}}' })}</li>
          <li>{t('seatEnd.effectTickets', { count: preview.ticketsWithClientIt, defaultValue: 'Tickets handed back to your team: {{count}}' })}</li>
          <li>{t('seatEnd.effectSeats', { count: preview.seatsToRelease, defaultValue: 'Seats released to the pool: {{count}}' })}</li>
          <li>{t('seatEnd.effectNotes', { defaultValue: 'Shared notes stay readable to your staff.' })}</li>
        </ul>
      </div>}
      confirmLabel={t('seatEnd.confirm', { defaultValue: 'End arrangement' })} cancelLabel={t('seatEnd.cancel', { defaultValue: 'Cancel' })} />
  </div>;
}
