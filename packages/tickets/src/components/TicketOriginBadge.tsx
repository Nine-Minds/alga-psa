'use client';

import React from 'react';
import { Building2, Code2, Mail, Monitor } from 'lucide-react';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
  labels: TicketOriginLabels
): string {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return labels.clientPortal;
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return labels.inboundEmail;
  }

  if (origin === TICKET_ORIGINS.API) {
    return labels.api;
  }

  if (origin === TICKET_ORIGIN_OTHER) {
    return labels.other;
  }

  return labels.internal;
}

function getOriginVariant(origin: ResolvedTicketOrigin): BadgeVariant {
  if (origin === TICKET_ORIGINS.CLIENT_PORTAL) {
    return 'info';
  }

  if (origin === TICKET_ORIGINS.INBOUND_EMAIL) {
    return 'warning';
  }

  if (origin === TICKET_ORIGINS.API) {
    return 'success';
  }

  return 'default-muted';
}

export default function TicketOriginBadge({
  origin,
  labels = {},
  size = 'sm',
  className,
}: TicketOriginBadgeProps) {
  const { t } = useTranslation('features/tickets');
  const normalizedOrigin = normalizeOrigin(origin);
  const resolvedLabels: TicketOriginLabels = {
    internal: labels.internal ?? t('origin.internal', 'Created Internally'),
    clientPortal: labels.clientPortal ?? t('origin.clientPortal', 'Created via Client Portal'),
    inboundEmail: labels.inboundEmail ?? t('origin.inboundEmail', 'Created via Inbound Email'),
    api: labels.api ?? t('origin.api', 'Created via API'),
    other: labels.other ?? t('origin.other', 'Created via Other'),
  };

  return (
    <Badge
      variant={getOriginVariant(normalizedOrigin)}
      size={size}
      className={className}
      data-testid="ticket-origin-badge"
      data-ticket-origin={normalizedOrigin}
    >
      <TicketOriginIcon origin={normalizedOrigin} />
      <span className="ml-1">{getLabel(normalizedOrigin, resolvedLabels)}</span>
    </Badge>
  );
}
