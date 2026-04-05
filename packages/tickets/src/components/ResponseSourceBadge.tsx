'use client';

import React from 'react';
import { Mail, Monitor } from 'lucide-react';
import { cn } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  COMMENT_RESPONSE_SOURCES,
  type CommentResponseSource,
} from '@alga-psa/types';

export interface ResponseSourceLabels {
  clientPortal: string;
  inboundEmail: string;
}

interface ResponseSourceBadgeProps {
  source: CommentResponseSource;
  labels?: Partial<ResponseSourceLabels>;
  size?: 'sm' | 'md';
  className?: string;
}

function ResponseSourceIcon({ source }: { source: CommentResponseSource }) {
  if (source === COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL) {
    return <Mail className="h-3 w-3" />;
  }

  return <Monitor className="h-3 w-3" />;
}

export default function ResponseSourceBadge({
  source,
  labels = {},
  size = 'sm',
  className,
}: ResponseSourceBadgeProps) {
  const { t } = useTranslation('features/tickets');
  const resolvedLabels: ResponseSourceLabels = {
    clientPortal: labels.clientPortal ?? t('responseSource.clientPortal', 'Received via Client Portal'),
    inboundEmail: labels.inboundEmail ?? t('responseSource.inboundEmail', 'Received via Inbound Email'),
  };
  const label =
    source === COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL
      ? resolvedLabels.inboundEmail
      : resolvedLabels.clientPortal;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-[rgb(var(--badge-default-border))] bg-[rgb(var(--badge-default-bg))] text-[rgb(var(--badge-default-text))]',
        size === 'md' ? 'px-2 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
        className
      )}
      data-testid="ticket-response-source-indicator"
      data-response-source={source}
    >
      <ResponseSourceIcon source={source} />
      <span>{label}</span>
    </div>
  );
}
