'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
  { variant: BadgeVariant; labelKey: string; defaultValue: string }
> = {
  not_synced: { variant: 'secondary', labelKey: 'invoiceSyncBadge.states.notSynced', defaultValue: 'Not synced' },
  queued: { variant: 'secondary', labelKey: 'invoiceSyncBadge.states.queued', defaultValue: 'Queued' },
  synced: { variant: 'success', labelKey: 'invoiceSyncBadge.states.synced', defaultValue: 'Synced' },
  drift: { variant: 'warning', labelKey: 'invoiceSyncBadge.states.drift', defaultValue: 'Drift' },
  error: { variant: 'error', labelKey: 'invoiceSyncBadge.states.error', defaultValue: 'Sync error' },
  voided: { variant: 'secondary', labelKey: 'invoiceSyncBadge.states.voided', defaultValue: 'Voided' },
};

export function InvoiceSyncBadge({ status, environment }: InvoiceSyncBadgeProps) {
  const { formatDate } = useFormatters();
  const { t } = useTranslation('msp/invoicing');
  const config = STATE_CONFIG[status.state] ?? STATE_CONFIG.not_synced;
  const label = t(config.labelKey, { defaultValue: config.defaultValue });

  const tooltipLines: React.ReactNode[] = [];

  if (status.docNumber) {
    tooltipLines.push(
      <div key="doc">
        {t('invoiceSyncBadge.tooltip.qboNumberPrefix', { defaultValue: 'QBO #' })}
        {status.docNumber}
      </div>,
    );
  }

  if (status.lastSyncedAt) {
    tooltipLines.push(
      <div key="synced">
        {t('invoiceSyncBadge.tooltip.lastSynced', { defaultValue: 'Last synced:' })}{' '}
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
          {t('invoiceSyncBadge.tooltip.viewInQuickBooks', { defaultValue: 'View in QuickBooks' })}
        </a>
      </div>,
    );
  }

  const tooltipContent =
    tooltipLines.length > 0 ? (
      <div className="space-y-1 text-xs">{tooltipLines}</div>
    ) : label;

  return (
    <Tooltip content={tooltipContent}>
      <Badge
        id={`invoice-sync-badge-${status.state}`}
        variant={config.variant}
        className="inline-flex items-center gap-1 whitespace-nowrap"
      >
        <span className="text-xs">{label}</span>
      </Badge>
    </Tooltip>
  );
}

export default InvoiceSyncBadge;
