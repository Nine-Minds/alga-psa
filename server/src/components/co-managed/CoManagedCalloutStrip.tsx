'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  buildTicketListHref,
  DEFAULT_TICKET_LIST_PRESENTATION,
  type TicketQueueSignal,
} from '@alga-psa/tickets/lib';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import { CoManagedWorkSignalsProvider, useCoManagedWorkSignals } from './CoManagedWorkSignalsProvider';

/** A segment deep-links to Customer Tickets filtered by its signal. */
export function calloutHref(signal: TicketQueueSignal): string {
  return buildTicketListHref(
    { kind: 'qualified', view: 'working', workspace: 'all' },
    { ...DEFAULT_TICKET_LIST_PRESENTATION, signal },
  );
}

function WorkCallout() {
  const { t } = useTranslation('msp/licensing');
  const signals = useCoManagedWorkSignals();
  if (!signals.available || signals.total <= 0) return null;
  return (
    <div
      id="co-managed-callout"
      role="status"
      data-testid="co-managed-callout"
      className="mb-3 flex items-center gap-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-primary-50))] px-3 py-2 text-sm"
    >
      <span className="font-medium">{t('coManaged.callout.title', { defaultValue: 'Customer tickets need you' })}</span>
      <div className="flex flex-1 flex-wrap items-center gap-3">
        {signals.escalatedUnassigned > 0 && (
          <Link id="co-managed-callout-escalated" href={calloutHref('escalated_unassigned')} className="underline-offset-2 hover:underline">
            {t('coManaged.callout.escalatedUnassigned', { count: signals.escalatedUnassigned, defaultValue: '{{count}} escalated, unassigned' })}
          </Link>
        )}
        {signals.awaitingReply > 0 && (
          <Link id="co-managed-callout-awaiting" href={calloutHref('awaiting_reply')} className="underline-offset-2 hover:underline">
            {t('coManaged.callout.awaitingReply', { count: signals.awaitingReply, defaultValue: '{{count}} awaiting your reply' })}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * The All Tickets `listCallout`. Behind the co-managed capability: closed means the
 * provider never mounts, so no action runs and nothing renders.
 */
export function CoManagedCalloutStrip() {
  return (
    <CoManagedFeatureBoundary mode="serves">
      <CoManagedWorkSignalsProvider><WorkCallout /></CoManagedWorkSignalsProvider>
    </CoManagedFeatureBoundary>
  );
}
