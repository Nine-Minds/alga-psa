'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Calculator, Cloud, Clock } from 'lucide-react';

import { TaxSource } from '@alga-psa/types';

export interface InvoiceTaxSourceBadgeProps {
  taxSource: TaxSource;
  externalAdapter?: string;
  importedAt?: string;
  className?: string;
}

const TAX_SOURCE_CONFIG = {
  internal: {
    icon: Calculator,
    variant: 'success' as const,
    labelKey: 'internal',
    tooltipKey: 'internal',
  },
  external: {
    icon: Cloud,
    variant: 'info' as const,
    labelKey: 'external',
    tooltipKey: 'external',
  },
  pending_external: {
    icon: Clock,
    variant: 'warning' as const,
    labelKey: 'pending',
    tooltipKey: 'pending',
  },
};

const ADAPTER_NAME_KEYS: Record<string, 'quickbooks' | 'xero' | 'sage'> = {
  quickbooks: 'quickbooks',
  quickbooks_online: 'quickbooks',
  xero: 'xero',
  sage: 'sage',
};

export function InvoiceTaxSourceBadge({
  taxSource,
  externalAdapter,
  importedAt,
  className = '',
}: InvoiceTaxSourceBadgeProps) {
  const { t } = useTranslation('msp/invoicing');
  const { formatDate } = useFormatters();
  const config = TAX_SOURCE_CONFIG[taxSource] || TAX_SOURCE_CONFIG.internal;
  const Icon = config.icon;
  const label = t(`taxBadge.labels.${config.labelKey}`, {
    defaultValue:
      config.labelKey === 'internal'
        ? 'Tax: Internal'
        : config.labelKey === 'external'
          ? 'Tax: External'
          : 'Tax: Pending',
  });

  const getAdapterName = (adapterType?: string): string | undefined => {
    if (!adapterType) {
      return undefined;
    }

    const adapterKey = ADAPTER_NAME_KEYS[adapterType];
    if (adapterKey) {
      return t(`taxBadge.adapterNames.${adapterKey}`, {
        defaultValue:
          adapterKey === 'quickbooks'
            ? 'QuickBooks Online'
            : adapterKey === 'xero'
              ? 'Xero'
              : 'Sage',
      });
    }

    return adapterType;
  };

  let tooltipContent = t(`taxBadge.tooltips.${config.tooltipKey}`, {
    defaultValue:
      config.tooltipKey === 'internal'
        ? 'Tax calculated by Alga PSA based on configured tax rates'
        : config.tooltipKey === 'external'
          ? 'Tax calculated by external accounting system'
          : 'Tax awaiting import from external accounting system',
  });

  if (taxSource === 'external' && externalAdapter) {
    const adapterName = getAdapterName(externalAdapter) ?? externalAdapter;
    tooltipContent = t('taxBadge.tooltips.externalAdapter', {
      adapter: adapterName,
      defaultValue: `Tax calculated by ${adapterName}`,
    });
    if (importedAt) {
      tooltipContent = t('taxBadge.tooltips.externalAdapterImportedAt', {
        adapter: adapterName,
        date: formatDate(importedAt, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        defaultValue: `${tooltipContent} on ${formatDate(importedAt, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}`,
      });
    }
  }

  if (taxSource === 'pending_external' && externalAdapter) {
    const adapterName = getAdapterName(externalAdapter) ?? externalAdapter;
    tooltipContent = t('taxBadge.tooltips.pendingAdapter', {
      adapter: adapterName,
      defaultValue: `Awaiting tax calculation from ${adapterName}`,
    });
  }

  return (
    <Tooltip content={tooltipContent}>
      <Badge
        variant={config.variant}
        className={`inline-flex items-center gap-1 ${className}`}
      >
        <Icon className="h-3 w-3" />
        <span className="text-xs">{label}</span>
      </Badge>
    </Tooltip>
  );
}

export default InvoiceTaxSourceBadge;
