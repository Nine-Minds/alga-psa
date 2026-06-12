'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';
import type { InvoiceSyncStatus } from '../../actions/accountingSyncActions';

export type QboEnvironment = 'sandbox' | 'production';

export interface InvoiceSyncBadgeProps {
  status: Pick<InvoiceSyncStatus, 'state' | 'docNumber' | 'lastSyncedAt' | 'externalId' | 'error'>;
  environment?: QboEnvironment;
}

export function qboInvoiceDeepLink(externalId: string, environment?: QboEnvironment): string {
  const base =
    environment === 'production'
      ? 'https://app.qbo.intuit.com/app/invoice'
      : 'https://app.sandbox.qbo.intuit.com/app/invoice';
  return `${base}?txnId=${encodeURIComponent(externalId)}`;
}

type BadgeVariant = 'secondary' | 'success' | 'warning' | 'error' | 'default' | 'info' | 'outline';

const STATE_CONFIG: Record<
  InvoiceSyncStatus['state'],
  { variant: BadgeVariant; label: string }
> = {
  not_synced: { variant: 'secondary', label: 'Not synced' },
  queued: { variant: 'secondary', label: 'Queued' },
  synced: { variant: 'success', label: 'Synced' },
  drift: { variant: 'warning', label: 'Drift' },
  error: { variant: 'error', label: 'Sync error' },
  voided: { variant: 'secondary', label: 'Voided' },
};

export function InvoiceSyncBadge({ status, environment }: InvoiceSyncBadgeProps) {
  const { formatDate } = useFormatters();
  const config = STATE_CONFIG[status.state] ?? STATE_CONFIG.not_synced;

  const tooltipLines: React.ReactNode[] = [];

  if (status.docNumber) {
    tooltipLines.push(
      <div key="doc">QBO #{status.docNumber}</div>,
    );
  }

  if (status.lastSyncedAt) {
    tooltipLines.push(
      <div key="synced">
        Last synced:{' '}
        {formatDate(status.lastSyncedAt, { year: 'numeric', month: 'short', day: 'numeric' })}
      </div>,
    );
  }

  if (status.error) {
    tooltipLines.push(
      <div key="error" className="text-error">
        {status.error}
      </div>,
    );
  }

  if (status.externalId) {
    const href = qboInvoiceDeepLink(status.externalId, environment);
    tooltipLines.push(
      <div key="link">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          onClick={(e) => e.stopPropagation()}
        >
          View in QuickBooks
        </a>
      </div>,
    );
  }

  const tooltipContent =
    tooltipLines.length > 0 ? (
      <div className="space-y-1 text-xs">{tooltipLines}</div>
    ) : config.label;

  return (
    <Tooltip content={tooltipContent}>
      <Badge
        id={`invoice-sync-badge-${status.state}`}
        variant={config.variant}
        className="inline-flex items-center gap-1 whitespace-nowrap"
      >
        <span className="text-xs">{config.label}</span>
      </Badge>
    </Tooltip>
  );
}

export default InvoiceSyncBadge;
