'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedTicketHandoffRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { escalateSharedTicketAction, handBackSharedTicketAction, revokeSharedTicketGrantAction } from '@/lib/actions/coManagedSharedWorkActions';

export type HandoffAction = 'escalate' | 'handback' | 'revoke';
export default function CoManagedHandoffComposer({ action, side, resource, revision, onSaved, onCancel, onReload }: {
  action: HandoffAction; side: 'customer' | 'sponsor'; resource: CoManagedSharedResource; revision: number;
  onSaved: () => void; onCancel: () => void; onReload: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const request = useRef<{ action: HandoffAction; resource: CoManagedSharedResource; input: CoManagedTicketHandoffRequest } | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const label = action === 'handback' && side === 'customer' ? 'takeBack' : action;
  async function submit() {
    if (inFlight.current || (!request.current && !note.trim())) return;
    request.current ??= { action, resource: { ...resource }, input: { operationId: crypto.randomUUID(), expectedRevision: revision, note: note.trim() } };
    inFlight.current = true; setBusy(true); setUncertain(false);
    const saved = request.current;
    try {
      const command = saved.action === 'escalate' ? escalateSharedTicketAction : saved.action === 'handback' ? handBackSharedTicketAction : revokeSharedTicketGrantAction;
      await command(saved.resource, saved.input);
    } catch {
      if (mounted.current) { setBusy(false); setUncertain(true); }
      inFlight.current = false;
      return;
    }
    inFlight.current = false;
    if (mounted.current) { setBusy(false); onSaved(); }
  }
  return <form className="space-y-3 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-semibold">{t(`coManaged.ticket.${label}`)}</h3>
    <p className="text-sm">{t(`coManaged.ticket.${action}Help`)}</p>
    <TextArea id="co-handoff-note" label={t('coManaged.ticket.note')} required maxLength={10000} value={note}
      disabled={busy || uncertain} onChange={event => setNote(event.target.value)} />
    <p className="text-sm text-muted-foreground">{t('coManaged.ticket.noteAudience')}</p>
    {uncertain && <p role="alert" className="text-destructive">{t('coManaged.ticket.uncertain')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button id="co-handoff-submit" type="submit" disabled={busy || !note.trim()}>{t(`coManaged.ticket.${busy ? 'saving' : uncertain ? 'retry' : label}`)}</Button>
      <Button id="co-handoff-cancel" type="button" variant="outline" disabled={busy} onClick={uncertain ? onReload : onCancel}>
        {t(`coManaged.ticket.${uncertain ? 'reload' : 'cancel'}`)}</Button>
    </div>
  </form>;
}
