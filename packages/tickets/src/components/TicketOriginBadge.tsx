'use client';

import React from 'react';
import { Building2, Mail, Monitor } from 'lucide-react';
import { cn } from '@alga-psa/ui';
import { TICKET_ORIGINS, type TicketOrigin } from '@alga-psa/types';

export interface TicketOriginLabels {
  internal: string;
  clientPortal: string;
  inboundEmail: string;
}

interface TicketOriginBadgeProps {
  origin: TicketOrigin;
  labels?: Partial<TicketOriginLabels>;
  size?: 'sm' | 'md';
  className?: string;
}

const DEFAULT_LABELS: TicketOriginLabels = {
  internal: 'Created Internally',
  clientPortal: 'Created via Client Portal',
  inboundEmail: 'Created via Inbound Email',
};

function TicketOriginIcon({ origin }: { origin: TicketOrigin }) {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return <Building2 className="h-3 w-3" />;
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return <Mail className="h-3 w-3" />;
  }

  return <Monitor className="h-3 w-3" />;
}

function getLabel(
  origin: TicketOrigin,
  labels: Partial<TicketOriginLabels>
): string {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return labels.clientPortal ?? DEFAULT_LABELS.clientPortal;
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return labels.inboundEmail ?? DEFAULT_LABELS.inboundEmail;
  }

  return labels.internal ?? DEFAULT_LABELS.internal;
}

function getOriginColorClasses(origin: TicketOrigin): string {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return 'border-blue-300 bg-blue-50 text-blue-700';
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return 'border-amber-300 bg-amber-50 text-amber-700';
  }

  return 'border-slate-300 bg-slate-100 text-slate-700';
}

export default function TicketOriginBadge({
  origin,
  labels = {},
  size = 'sm',
  className,
}: TicketOriginBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        getOriginColorClasses(origin),
        size === 'md' ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
        className
      )}
      data-testid="ticket-origin-badge"
      data-ticket-origin={origin}
    >
      <TicketOriginIcon origin={origin} />
      <span>{getLabel(origin, labels)}</span>
    </div>
  );
}
