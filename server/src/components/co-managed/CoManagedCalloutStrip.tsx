'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  buildTicketListHref,
  DEFAULT_TICKET_LIST_PRESENTATION,
  type TicketQueueSignal,
} from '@alga-psa/tickets/lib';
import { getCoManagedWorkSignalsAction } from '@/lib/actions/coManagedTicketQueueActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import { useCoManagedWorkSignals } from './CoManagedWorkSignalsProvider';

const DISMISS_PREFIX = 'alga.coManaged.callout.dismissed:';

interface Counts { escalatedUnassigned: number; awaitingReply: number }
type Dismissed = Partial<Counts>;

export function calloutHref(signal: TicketQueueSignal, clientId?: string): string {
  return buildTicketListHref(
    { kind: 'qualified', view: 'working', workspace: 'all' },
    { ...DEFAULT_TICKET_LIST_PRESENTATION, signal, ...(clientId ? { clientId } : {}) },
    { includeClient: Boolean(clientId) },
  );
}

/** In-memory fallback for the life of the page when browser storage is missing or throws. */
const memoryDismissals = new Map<string, Dismissed>();

function readDismissed(key: string): Dismissed {
  // No window during the server render; the strip only renders after client-side signals resolve anyway.
  if (typeof window === 'undefined') return memoryDismissals.get(key) ?? {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Dismissed) : {};
  } catch {
    return memoryDismissals.get(key) ?? {};
  }
}

function writeDismissed(key: string, counts: Counts): void {
  memoryDismissals.set(key, counts);
  try { window.localStorage.setItem(key, JSON.stringify(counts)); } catch { /* in-memory only */ }
}

/**
 * Dismissal is remembered per viewer and per count in browser storage, so a
 * dismissed segment stays hidden until its count rises above the dismissed value. Storage that is missing or
 * throws degrades to in-memory dismissal for the life of the page.
 */
export function useCalloutDismissal(viewerId: string | null, scopeKey: string): [Dismissed, (counts: Counts) => void] {
  const key = `${DISMISS_PREFIX}${viewerId ?? 'anonymous'}:${scopeKey}`;
  // The state remembers which key it was read for. A different key is re-read
  // during render, so a dismissed strip never paints and one key's dismissal is
  // never applied to another.
  const [state, setState] = useState<{ key: string; value: Dismissed }>(() => ({ key, value: readDismissed(key) }));
  let value = state.value;
  if (state.key !== key) {
    value = readDismissed(key);
    setState({ key, value });
  }
  const dismiss = useCallback((counts: Counts) => {
    setState({ key, value: counts });
    writeDismissed(key, counts);
  }, [key]);
  return [value, dismiss];
}

/** A segment deep-links to Customer Tickets filtered by its signal (and the client, on a client screen). */
function CalloutSegment({ id, href, children }: { id: string; href: string; children: React.ReactNode }) {
  return <Link id={id} href={href} className="underline-offset-2 hover:underline">{children}</Link>;
}

function CalloutBody({ counts, viewerId, scopeKey, clientId }: { counts: Counts; viewerId: string | null; scopeKey: string; clientId?: string }) {
  const { t } = useTranslation('msp/licensing');
  const [dismissed, dismiss] = useCalloutDismissal(viewerId, scopeKey);
  const showEscalated = counts.escalatedUnassigned > 0 && counts.escalatedUnassigned > (dismissed.escalatedUnassigned ?? 0);
  const showAwaiting = counts.awaitingReply > 0 && counts.awaitingReply > (dismissed.awaitingReply ?? 0);
  if (!showEscalated && !showAwaiting) return null;

  return (
    <div
      id={`co-managed-callout-${scopeKey}`}
      role="status"
      data-testid="co-managed-callout"
      className="mb-3 flex items-center gap-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-primary-50))] px-3 py-2 text-sm"
    >
      <span className="font-medium">{t('coManaged.callout.title', { defaultValue: 'Customer tickets need you' })}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {showEscalated && (
          <CalloutSegment
            id={`co-managed-callout-escalated-${scopeKey}`}
            href={calloutHref('escalated_unassigned', clientId)}
          >
            {t('coManaged.callout.escalatedUnassigned', { count: counts.escalatedUnassigned, defaultValue: '{{count}} escalated, unassigned' })}
          </CalloutSegment>
        )}
        {showAwaiting && (
          <CalloutSegment
            id={`co-managed-callout-awaiting-${scopeKey}`}
            href={calloutHref('awaiting_reply', clientId)}
          >
            {t('coManaged.callout.awaitingReply', { count: counts.awaitingReply, defaultValue: '{{count}} awaiting your reply' })}
          </CalloutSegment>
        )}
      </div>
      <button
        id={`co-managed-callout-dismiss-${scopeKey}`}
        type="button"
        aria-label={t('coManaged.callout.dismiss', { defaultValue: 'Dismiss' })}
        className="rounded p-1 hover:bg-[rgb(var(--color-border-100))]"
        onClick={() => dismiss(counts)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** All Tickets mount: reads the shared provider, so it adds no request of its own. */
function WorkCallout() {
  const signals = useCoManagedWorkSignals();
  if (!signals.available || signals.total <= 0) return null;
  return <CalloutBody counts={signals} viewerId={signals.viewerId} scopeKey="all" />;
}

export function CoManagedCalloutStrip() {
  return <CoManagedFeatureBoundary><WorkCallout /></CoManagedFeatureBoundary>;
}

/** Client Tickets tab mount: counts narrowed to one client. Silent on error, empty or zero. */
function ClientCallout({ clientId }: { clientId: string }) {
  const { available, viewerId } = useCoManagedWorkSignals();
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    if (!available) { setCounts(null); return; }
    let cancelled = false;
    getCoManagedWorkSignalsAction({ clientId })
      .then((r) => { if (!cancelled) setCounts(r?.signals ? { ...r.signals } : null); })
      .catch(() => { if (!cancelled) setCounts(null); });
    return () => { cancelled = true; };
  }, [available, clientId]);
  if (!available || !counts || counts.escalatedUnassigned + counts.awaitingReply <= 0) return null;
  return <CalloutBody counts={counts} viewerId={viewerId} scopeKey={`client-${clientId}`} clientId={clientId} />;
}

export function CoManagedClientCalloutStrip({ clientId }: { clientId: string }) {
  return <CoManagedFeatureBoundary><ClientCallout clientId={clientId} /></CoManagedFeatureBoundary>;
}
