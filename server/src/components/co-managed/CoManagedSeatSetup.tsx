'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { enableCoManagedSeatArrangementAction, getCoManagedSeatAdminOptions } from '@/lib/actions/coManagedSeatActions';
import CoManagedSeatContactField from './CoManagedSeatContactField';
import CoManagedSeatBoardPicker, { type SeatBoardChoice } from './CoManagedSeatBoardPicker';
import { coManagedSeatMessage } from './coManagedSeatMessage';
import { newCoManagedOperationId } from './coManagedOperationId';

/**
 * Seat shape setup: how many seats, which boards, and the first technician. Confirming calls one
 * server action, which reserves the seats, writes the arrangement, sets the board scope and sends the
 * invitation. The operation id is kept across submits so a repeat returns the same arrangement.
 */
export default function CoManagedSeatSetup({ clientId, idPrefix, available, onEnabled, onDirtyChange }: {
  clientId: string;
  idPrefix: string;
  available: number;
  onEnabled: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [boards, setBoards] = useState<Array<{ boardId: string; name: string }>>([]);
  const [scope, setScope] = useState<SeatBoardChoice>({});
  const [seats, setSeats] = useState(1);
  const [contactId, setContactId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef(newCoManagedOperationId());
  const firstRender = useRef(true);

  useEffect(() => {
    let cancelled = false;
    void getCoManagedSeatAdminOptions(clientId).then((options) => { if (!cancelled) setBoards(options.boards); })
      .catch(() => { if (!cancelled) setError(t('coManaged.seat.error.load', { defaultValue: 'Could not load the choices. Refresh and try again.' })); });
    return () => { cancelled = true; };
  }, [clientId, t]);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    onDirtyChange?.(true);
  }, [seats, contactId, scope, onDirtyChange]);

  const valid = Number.isInteger(seats) && seats >= 1 && seats <= available && contactId !== '';

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await enableCoManagedSeatArrangementAction({
        clientId, operationId: operationId.current, seats, contactId,
        boards: Object.entries(scope).map(([boardId, entry]) => ({ boardId, canCreate: entry.canCreate })),
      });
      if ('rejected' in result) { setError(coManagedSeatMessage(result.errorCode, t)); return; }
      // The arrangement exists: whatever a later step said, the panel is where it is finished.
      onDirtyChange?.(false);
      operationId.current = newCoManagedOperationId();
      await onEnabled();
    } catch {
      setError(t('coManaged.seat.error.submit', { defaultValue: 'The request may not have finished. Try again; it will not be applied twice.' }));
    } finally { setBusy(false); }
  };

  return (
    <form id={`${idPrefix}-seat-setup`} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error && <Alert variant="destructive"><AlertDescription id={`${idPrefix}-seat-error`}>{error}</AlertDescription></Alert>}
      <fieldset disabled={busy} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-seat-count`}>{t('coManaged.seat.setup.seats', { defaultValue: 'Number of seats' })}</Label>
          <Input id={`${idPrefix}-seat-count`} type="number" required min={1} max={Math.max(1, available)} step={1} value={seats}
            onChange={(event) => setSeats(Number(event.target.value))} />
        </div>
        <div className="space-y-2">
          <Label>{t('coManaged.seat.setup.boards', { defaultValue: 'Boards in scope' })}</Label>
          <p className="text-sm text-muted-foreground">{t('coManaged.seat.setup.boardsHint', { defaultValue: 'Technicians see tickets of their company on these boards only.' })}</p>
          <CoManagedSeatBoardPicker idPrefix={idPrefix} boards={boards} value={scope} onChange={setScope} />
        </div>
        <div className="space-y-2">
          <Label>{t('coManaged.seat.setup.technician', { defaultValue: 'First technician' })}</Label>
          <p className="text-sm text-muted-foreground">{t('coManaged.seat.setup.technicianHint', { defaultValue: 'Choose one of this client\'s contacts. They are invited by email.' })}</p>
          <CoManagedSeatContactField clientId={clientId} idPrefix={idPrefix} value={contactId} onChange={setContactId} disabled={busy} />
        </div>
      </fieldset>
      <Button id={`${idPrefix}-seat-submit`} type="submit" disabled={busy || !valid}>
        {t('coManaged.seat.setup.submit', { defaultValue: 'Enable seats' })}
      </Button>
    </form>
  );
}
