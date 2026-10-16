'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedTicketHandoffRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { escalateSharedTicketAction, handBackSharedTicketAction, revokeSharedTicketGrantAction } from '@/lib/actions/coManagedSharedWorkActions';
import { newCoManagedOperationId } from './coManagedOperationId';
import { useCoManagedWorkSignals } from './CoManagedWorkSignalsProvider';

export type HandoffAction = 'escalate' | 'handback' | 'revoke';

/**
 * Escalate / hand back / take back / revoke as a native Dialog with the
 * footer pattern. The command is frozen on first submit (one operation id,
 * one expectedRevision) so an uncertain outcome is retried as the same
 * request, never as a second operation.
 */
export default function CoManagedHandoffDialog({ action, side, resource, revision, onSaved, onClose, onReload }: {
  action: HandoffAction; side: 'customer' | 'sponsor'; resource: CoManagedSharedResource; revision: number;
  onSaved: () => void; onClose: () => void; onReload: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const { refresh: refreshWorkSignals } = useCoManagedWorkSignals();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const request = useRef<{ action: HandoffAction; resource: CoManagedSharedResource; input: CoManagedTicketHandoffRequest } | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const label = action === 'handback' && side === 'customer' ? 'takeBack' : action;
  const id = 'co-ticket-handoff';

  async function submit() {
    if (inFlight.current || (!request.current && !note.trim())) return;
    request.current ??= { action, resource: { ...resource }, input: { operationId: newCoManagedOperationId(), expectedRevision: revision, note: note.trim() } };
    inFlight.current = true; setBusy(true); setUncertain(false); setSetupRequired(false);
    const saved = request.current;
    try {
      const command = saved.action === 'escalate' ? escalateSharedTicketAction : saved.action === 'handback' ? handBackSharedTicketAction : revokeSharedTicketGrantAction;
      const result = await command(saved.resource, saved.input);
      if ('setupRequired' in result) {
        inFlight.current = false;
        if (mounted.current) { setBusy(false); setSetupRequired(true); request.current = null; }
        return;
      }
    } catch {
      inFlight.current = false;
      if (mounted.current) { setBusy(false); setUncertain(true); }
      return;
    }
    inFlight.current = false;
    // Escalate / hand back / take back changes the callout and badge counts.
    refreshWorkSignals();
    if (mounted.current) { setBusy(false); onSaved(); }
  }

  const dismiss = () => { if (!inFlight.current) onClose(); };
  return <Dialog id={`${id}-dialog`} isOpen title={t(`coManaged.ticket.${label}`)} onClose={dismiss} hideCloseButton={busy}
    footer={<div className="flex justify-end gap-2">
      <Button id={`${id}-cancel`} type="button" variant="outline" disabled={busy} onClick={uncertain ? onReload : dismiss}>
        {t(`coManaged.ticket.${uncertain ? 'reload' : 'cancel'}`)}</Button>
      <Button id={`${id}-submit`} type="button" disabled={busy || (!request.current && !note.trim())} onClick={() => void submit()}>
        {t(`coManaged.ticket.${busy ? 'saving' : uncertain ? 'retry' : label}`)}</Button>
    </div>}>
    <DialogContent><div className="space-y-3">
      <p className="text-sm text-[rgb(var(--color-text-700))]">{t(`coManaged.ticket.${action}Help`)}</p>
      <TextArea id={`${id}-note`} label={t('coManaged.ticket.note')} required maxLength={10000} value={note}
        disabled={busy || uncertain} onChange={event => setNote(event.target.value)} />
      <p className="text-xs text-[rgb(var(--color-text-500))]">{t('coManaged.ticket.noteAudience')}</p>
      {uncertain && <p role="alert" className="text-sm text-destructive">{t('coManaged.ticket.uncertain')}</p>}
      {setupRequired && <p role="alert" className="text-sm text-destructive">{t('coManaged.ticket.slaSetupRequired')}</p>}
    </div></DialogContent>
  </Dialog>;
}
