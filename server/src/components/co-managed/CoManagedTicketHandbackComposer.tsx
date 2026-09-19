'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoManagedBulkHandbackRequest, CoManagedBulkHandbackResult, CoManagedTicketQueueItem } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isQualifiedHandbackEligible } from '@alga-psa/tickets/lib';
import { bulkHandBackCoManagedTicketsAction } from '@/lib/actions/coManagedTicketQueueActions';

const STORAGE_VERSION = 1;
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

interface PersistedIntent {
  version: number;
  expiresAt: number;
  actorScope: string;
  request: CoManagedBulkHandbackRequest;
  labels: string[];
}

function storageKey(actorScope: string): string {
  return `co-managed:handback-intent:${actorScope}`;
}

function readIntent(actorScope: string): PersistedIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(actorScope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedIntent;
    if (parsed?.version !== STORAGE_VERSION || parsed.actorScope !== actorScope) return null;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(storageKey(actorScope));
      return null;
    }
    if (!parsed.request?.items?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeIntent(intent: PersistedIntent): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.sessionStorage.setItem(storageKey(intent.actorScope), JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}

function clearIntent(actorScope: string): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(storageKey(actorScope)); } catch { /* storage unavailable */ }
}

/**
 * The single handback composer for qualified rows.
 *
 * Selection is owned by the list table, not this component: the previous
 * standalone checklist duplicated the table's selection and could disagree with
 * it. This composer only requires the shared IT note, freezes the exact
 * resources/revisions/note before first submission, and reuses that frozen
 * command for an uncertain retry. Unresolved intent is persisted per actor/home
 * so a reload can offer a resume without ever auto-submitting.
 */
export default function CoManagedTicketHandbackComposer({
  selectedItems,
  onDone,
  actorScope,
  idPrefix = 'co-managed-handback',
}: {
  selectedItems: CoManagedTicketQueueItem[];
  onDone: () => void;
  actorScope: string;
  idPrefix?: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const eligible = useMemo(() => selectedItems.filter(isQualifiedHandbackEligible), [selectedItems]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [results, setResults] = useState<CoManagedBulkHandbackResult[] | null>(null);
  const [restored, setRestored] = useState<PersistedIntent | null>(null);
  const saved = useRef<PersistedIntent | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const intent = readIntent(actorScope);
    if (intent) setRestored(intent);
    return () => { mounted.current = false; };
  }, [actorScope]);

  const label = useCallback((item: CoManagedTicketQueueItem) => (
    `${item.workspaceName} · ${[item.fields.ticket_number, item.fields.title].filter(Boolean).join(' · ') || t('coManaged.ticket.restricted')}`
  ), [t]);

  const buildRequest = useCallback((): PersistedIntent | null => {
    const chosen = eligible;
    if (!chosen.length || !note.trim()) return null;
    return {
      version: STORAGE_VERSION,
      expiresAt: Date.now() + STORAGE_TTL_MS,
      actorScope,
      labels: chosen.map(label),
      request: {
        note: note.trim(),
        items: chosen.map(item => ({
          operationId: crypto.randomUUID(),
          expectedRevision: item.fields.work_revision as number,
          resource: {
            kind: 'ticket',
            tenant: item.tenant,
            relationshipId: item.relationshipId as string,
            id: item.ticketId,
          },
        })),
      },
    };
  }, [actorScope, eligible, label, note]);

  const submit = useCallback(async (intent?: PersistedIntent) => {
    if (inFlight.current || results) return;
    let frozen = intent ?? saved.current ?? restored ?? null;
    if (!frozen) {
      const built = buildRequest();
      if (!built) return;
      // Persist the exact replay command before the first submission so a lost
      // transport cannot force a new operation identity.
      const wrote = writeIntent(built);
      setStorageAvailable(wrote);
      frozen = built;
    }
    saved.current = frozen;
    inFlight.current = true;
    setBusy(true);
    setUncertain(false);
    try {
      const response = await bulkHandBackCoManagedTicketsAction(frozen.request);
      if (!mounted.current) return;
      setResults(response);
      setRestored(null);
      clearIntent(actorScope);
    } catch {
      if (!mounted.current) return;
      setUncertain(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [actorScope, buildRequest, restored, results]);

  // A restored intent is shown as unresolved and never submitted automatically.
  if (restored && !results) {
    return (
      <div id={`${idPrefix}-resume`} className="rounded-lg border border-[rgb(var(--color-border-200))] p-4" role="alert">
        <p className="text-sm">{t('coManaged.queue.bulkHandback.resume', 'A return to customer IT was interrupted. Resume it to confirm the result.')}</p>
        <div className="mt-2 flex gap-2">
          <Button id={`${idPrefix}-resume-submit`} type="button" disabled={busy} onClick={() => void submit(restored)}>
            {t('coManaged.ticket.retry', 'Retry')}
          </Button>
          <Button id={`${idPrefix}-resume-discard`} type="button" variant="outline" disabled={busy} onClick={() => { clearIntent(actorScope); setRestored(null); }}>
            {t('actions.cancel', 'Cancel')}
          </Button>
        </div>
      </div>
    );
  }

  if (!eligible.length && !results) return null;

  const activeIntent = saved.current ?? restored;
  return (
    <details id={idPrefix} className="rounded-lg border border-[rgb(var(--color-border-200))] p-4">
      <summary id={`${idPrefix}-open`} className="cursor-pointer font-medium">
        {t('coManaged.queue.bulkHandback.title', 'Return tickets to customer IT')}
      </summary>
      <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p className="text-sm">
          {t('coManaged.queue.bulkHandback.selected', { count: eligible.length, defaultValue: '{{count}} selected ticket(s) will be returned.' })}
        </p>
        <TextArea
          id={`${idPrefix}-note`}
          label={t('coManaged.ticket.note', 'Shared IT note')}
          value={note}
          required
          maxLength={10000}
          disabled={busy || uncertain || !!results}
          onChange={event => setNote(event.target.value)}
        />
        <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.ticket.noteAudience')}</p>
        {!storageAvailable && <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.queue.bulkHandback.noReloadRecovery', 'Reload recovery is unavailable in this browser; you can still retry in this session.')}</p>}
        {uncertain && <p role="alert" className="text-destructive">{t('coManaged.ticket.uncertain')}</p>}
        {results && (
          <ul role="status" className="space-y-1">
            {results.map(result => (
              <li key={result.index}>
                {activeIntent?.labels[result.index]}: {t(result.ok ? 'coManaged.queue.bulkHandback.returned' : result.code === 'readOnly' ? 'coManaged.ticket.readOnly' : `coManaged.queue.bulkHandback.${result.code}`)}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          {!results && (
            <Button id={`${idPrefix}-submit`} type="submit" disabled={busy || !eligible.length || !note.trim()}>
              {t(`coManaged.ticket.${busy ? 'saving' : uncertain ? 'retry' : 'handback'}`)}
            </Button>
          )}
          <Button id={`${idPrefix}-reload`} type="button" variant="outline" disabled={busy} onClick={onDone}>
            {t('coManaged.ticket.reload', 'Reload')}
          </Button>
        </div>
      </form>
    </details>
  );
}
