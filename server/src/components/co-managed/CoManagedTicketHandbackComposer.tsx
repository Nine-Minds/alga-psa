'use client';

import { useRef, useState } from 'react';
import type { CoManagedBulkHandbackRequest, CoManagedBulkHandbackResult } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { bulkHandBackCoManagedTicketsAction } from '@/lib/actions/coManagedTicketQueueActions';
import { newCoManagedOperationId } from './coManagedOperationId';

/** One ticket to hand back: the display label and exactly what the command needs. */
export interface HandbackTarget {
  key: string;
  label: string;
  tenant: string;
  relationshipId: string;
  ticketId: string;
  expectedRevision: number;
}

/**
 * Plain bulk handback: the selected targets plus one shared IT note go to the one
 * server action, which re-admits each ticket and answers per row. There is no queue
 * and no automatic retry. A lost transport leaves the frozen command (same operation
 * ids) behind one explicit Retry button, which the server treats idempotently.
 *
 * Selection is owned by the caller; this component only renders when something is
 * selected, so a viewer who cannot hand anything back never sees it.
 */
export default function CoManagedTicketHandbackComposer({ targets, idPrefix = 'co-managed-handback', onDone }: {
  targets: HandbackTarget[];
  /** Called when the user dismisses the outcome (or reloads); the caller clears its selection and re-reads. */
  onDone: () => void;
  idPrefix?: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [outcome, setOutcome] = useState<{ labels: string[]; results: CoManagedBulkHandbackResult[] } | null>(null);
  const frozen = useRef<{ request: CoManagedBulkHandbackRequest; labels: string[] } | null>(null);
  const inFlight = useRef(false);

  if (!targets.length && !outcome) return null;

  const submit = async () => {
    if (inFlight.current || outcome) return;
    if (!frozen.current) {
      if (!targets.length || !note.trim()) return;
      frozen.current = {
        labels: targets.map(target => target.label),
        request: {
          note: note.trim(),
          items: targets.map(target => ({
            operationId: newCoManagedOperationId(),
            expectedRevision: target.expectedRevision,
            resource: { kind: 'ticket', tenant: target.tenant, relationshipId: target.relationshipId, id: target.ticketId },
          })),
        },
      };
    }
    const { request, labels } = frozen.current;
    inFlight.current = true;
    setBusy(true);
    setUncertain(false);
    try {
      const results = await bulkHandBackCoManagedTicketsAction(request);
      setOutcome({ labels, results });
      frozen.current = null;
    } catch {
      setUncertain(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const locked = busy || uncertain || Boolean(outcome);
  return (
    <details id={idPrefix} open className="rounded-lg border border-[rgb(var(--color-border-200))] p-4">
      <summary id={`${idPrefix}-open`} className="cursor-pointer font-medium">
        {t('coManaged.queue.bulkHandback.title', 'Return tickets to customer IT')}
      </summary>
      <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
        {!outcome && (
          <>
            <p className="text-sm">
              {t('coManaged.queue.bulkHandback.selected', { count: targets.length, defaultValue: '{{count}} selected ticket(s) will be returned.' })}
            </p>
            <TextArea
              id={`${idPrefix}-note`}
              label={t('coManaged.ticket.note', 'Shared IT note')}
              value={note}
              required
              maxLength={10000}
              disabled={locked}
              onChange={event => setNote(event.target.value)}
            />
            <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.ticket.noteAudience', 'This note is visible to the customer.')}</p>
          </>
        )}
        {uncertain && <p role="alert" className="text-destructive">{t('coManaged.ticket.uncertain', 'We could not confirm the result. Retry to confirm; the request will not be applied twice.')}</p>}
        {outcome && (
          <ul id={`${idPrefix}-results`} role="status" className="space-y-1">
            {outcome.results.map(result => (
              <li key={result.index}>
                {outcome.labels[result.index]}: {result.ok
                  ? t('coManaged.queue.bulkHandback.returned', 'Returned')
                  : t(`coManaged.queue.bulkHandback.${result.code}`)}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          {!outcome ? (
            <Button id={`${idPrefix}-submit`} type="submit" disabled={busy || !targets.length || (!uncertain && !note.trim())}>
              {busy ? t('coManaged.ticket.saving', 'Saving…') : uncertain ? t('coManaged.ticket.retry', 'Retry') : t('coManaged.ticket.handback', 'Return to customer IT')}
            </Button>
          ) : (
            <Button id={`${idPrefix}-done`} type="button" onClick={onDone}>{t('coManaged.queue.bulkHandback.done', 'Done')}</Button>
          )}
        </div>
      </form>
    </details>
  );
}
