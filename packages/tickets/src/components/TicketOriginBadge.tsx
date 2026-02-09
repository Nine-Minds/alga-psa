'use client';

import React from 'react';
import { Building2, Code2, Mail, Monitor } from 'lucide-react';
import { cn } from '@alga-psa/ui';
import { TICKET_ORIGINS } from '@alga-psa/types';
import {
  TICKET_ORIGIN_OTHER,
  type ResolvedTicketOrigin,
} from '../lib/ticketOrigin';

export interface TicketOriginLabels {
  internal: string;
  clientPortal: string;
  inboundEmail: string;
  api: string;
  other: string;
}

interface TicketOriginBadgeProps {
  origin: ResolvedTicketOrigin | string | null | undefined;
  labels?: Partial<TicketOriginLabels>;
  size?: 'sm' | 'md';
  className?: string;
}

const DEFAULT_LABELS: TicketOriginLabels = {
  internal: 'Created Internally',
  clientPortal: 'Created via Client Portal',
  inboundEmail: 'Created via Inbound Email',
  api: 'Created via API',
  other: 'Created via Other',
};

function normalizeOrigin(origin: TicketOriginBadgeProps['origin']): ResolvedTicketOrigin {
  if (typeof origin !== 'string') {
    return TICKET_ORIGINS.INTERNAL;
  }

  const normalized = origin.trim().toLowerCase();
  if (!normalized) {
    return TICKET_ORIGINS.INTERNAL;
  }

  if (normalized === TICKET_ORIGINS.INTERNAL) {
    return TICKET_ORIGINS.INTERNAL;
  }

  if (normalized === TICKET_ORIGINS.CLIENT_PORTAL) {
    return TICKET_ORIGINS.CLIENT_PORTAL;
  }

  if (normalized === TICKET_ORIGINS.INBOUND_EMAIL) {
    return TICKET_ORIGINS.INBOUND_EMAIL;
  }

  if (normalized === TICKET_ORIGINS.API) {
    return TICKET_ORIGINS.API;
  }

  if (normalized === TICKET_ORIGIN_OTHER) {
    return TICKET_ORIGIN_OTHER;
  }

  return TICKET_ORIGIN_OTHER;
}

function TicketOriginIcon({ origin }: { origin: ResolvedTicketOrigin }) {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return <Building2 className="h-3 w-3" />;
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return <Mail className="h-3 w-3" />;
  }

  if (origin === TICKET_ORIGINS.API) {
    return <Code2 className="h-3 w-3" />;
  }

  return <Monitor className="h-3 w-3" />;
}

function getLabel(
  origin: ResolvedTicketOrigin,
  labels: Partial<TicketOriginLabels>
): string {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return labels.clientPortal ?? DEFAULT_LABELS.clientPortal;
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return labels.inboundEmail ?? DEFAULT_LABELS.inboundEmail;
  }

  if (origin === TICKET_ORIGINS.API) {
    return labels.api ?? DEFAULT_LABELS.api;
  }

  if (origin === TICKET_ORIGIN_OTHER) {
    return labels.other ?? DEFAULT_LABELS.other;
  }

  return labels.internal ?? DEFAULT_LABELS.internal;
}

function getOriginColorClasses(origin: ResolvedTicketOrigin): string {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return 'border-blue-300 bg-blue-50 text-blue-700';
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return 'border-amber-300 bg-amber-50 text-amber-700';
  }

  if (origin === TICKET_ORIGINS.API) {
    return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  }

  if (origin === TICKET_ORIGIN_OTHER) {
    return 'border-zinc-300 bg-zinc-100 text-zinc-700';
  }

  return 'border-slate-300 bg-slate-100 text-slate-700';
}

export default function TicketOriginBadge({
  origin,
  labels = {},
  size = 'sm',
  className,
}: TicketOriginBadgeProps) {
  const normalizedOrigin = normalizeOrigin(origin);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        getOriginColorClasses(normalizedOrigin),
        size === 'md' ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
        className
      )}
      data-testid="ticket-origin-badge"
      data-ticket-origin={normalizedOrigin}
    >
      <TicketOriginIcon origin={normalizedOrigin} />
      <span>{getLabel(normalizedOrigin, labels)}</span>
    </div>
  );
}
