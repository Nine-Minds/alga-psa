'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedTicketQueueItem, CoManagedBulkHandbackRequest, CoManagedBulkHandbackResult } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { bulkHandBackCoManagedTicketsAction } from '@/lib/actions/coManagedTicketQueueActions';

const identity = (item: CoManagedTicketQueueItem) => `${item.tenant}:${item.relationshipId}:${item.ticketId}`;

export default function CoManagedTicketBulkHandback({ items, onDone }: { items: CoManagedTicketQueueItem[]; onDone: () => void }) {
  const { t } = useTranslation('msp/licensing');
  const eligible = items.filter(item => item.relationshipId && item.fields.responsibility === 'msp' && typeof item.fields.work_revision === 'number');
  const [selected, setSelected] = useState<string[]>([]), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [results, setResults] = useState<CoManagedBulkHandbackResult[] | null>(null);
  const saved = useRef<{ request: CoManagedBulkHandbackRequest; labels: string[] } | null>(null);
  const mounted = useRef(false), inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const label = (item: CoManagedTicketQueueItem) => `${item.workspaceName} · ${[item.fields.ticket_number, item.fields.title].filter(Boolean).join(' · ') || t('coManaged.ticket.restricted')}`;
  async function submit() {
    if (inFlight.current || results) return;
    if (!saved.current) {
      const chosen = eligible.filter(item => selected.includes(identity(item)));
      if (!chosen.length || !note.trim()) return;
      saved.current = { labels: chosen.map(label), request: { note: note.trim(), items: chosen.map(item => ({ operationId: crypto.randomUUID(), expectedRevision: item.fields.work_revision!,
        resource: { kind: 'ticket', tenant: item.tenant, relationshipId: item.relationshipId!, id: item.ticketId } })) } };
    }
    inFlight.current = true; setBusy(true); setUncertain(false);
    try {
      const response = await bulkHandBackCoManagedTicketsAction(saved.current.request);
      if (mounted.current) setResults(response);
    } catch { if (mounted.current) setUncertain(true); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  if (!eligible.length) return null;
  return <details id="co-queue-bulk-handback" className="rounded-lg border p-4">
    <summary id="co-queue-bulk-handback-open" className="cursor-pointer font-medium">{t('coManaged.queue.bulkHandback.title')}</summary>
    <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="text-sm">{t('coManaged.queue.bulkHandback.select')}</p>
      <div className="space-y-2">{eligible.map((item, index) => <Checkbox key={identity(item)} id={`co-queue-bulk-select-${index}`} label={label(item)} checked={selected.includes(identity(item))}
        disabled={busy || uncertain || !!results} onChange={event => setSelected(previous => event.target.checked ? [...previous, identity(item)] : previous.filter(key => key !== identity(item)))} />)}</div>
      <TextArea id="co-queue-bulk-note" label={t('coManaged.ticket.note')} value={note} required maxLength={10000} disabled={busy || uncertain || !!results} onChange={event => setNote(event.target.value)} />
      <p className="text-sm text-muted-foreground">{t('coManaged.ticket.noteAudience')}</p>
      {uncertain && <p role="alert" className="text-destructive">{t('coManaged.ticket.uncertain')}</p>}
      {results && <ul role="status" className="space-y-1">{results.map(result => <li key={result.index}>
        {saved.current?.labels[result.index]}: {t(result.ok ? 'coManaged.queue.bulkHandback.returned' : result.code === 'readOnly' ? 'coManaged.ticket.readOnly' : `coManaged.queue.bulkHandback.${result.code}`)}
      </li>)}</ul>}
      <div className="flex gap-2">
        {!results && <Button id="co-queue-bulk-submit" type="submit" disabled={busy || !selected.length || !note.trim()}>{t(`coManaged.ticket.${busy ? 'saving' : uncertain ? 'retry' : 'handback'}`)}</Button>}
        <Button id="co-queue-bulk-reload" type="button" variant="outline" disabled={busy} onClick={onDone}>{t('coManaged.ticket.reload')}</Button>
      </div>
    </form>
  </details>;
}
