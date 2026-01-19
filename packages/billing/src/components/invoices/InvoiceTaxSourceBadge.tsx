'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Calculator, Cloud, Clock } from 'lucide-react';

import { TaxSource } from '@alga-psa/types';

interface InvoiceTaxSourceBadgeProps {
  taxSource: TaxSource;
  externalAdapter?: string;
  importedAt?: string;
  className?: string;
}

const TAX_SOURCE_CONFIG = {
  internal: {
    label: 'Tax: Internal',
    icon: Calculator,
    className: 'bg-green-100 text-green-800 border-green-200',
    tooltip: 'Tax calculated by Alga PSA based on configured tax rates',
  },
  external: {
    label: 'Tax: External',
    icon: Cloud,
    className: 'bg-blue-100 text-blue-800 border-blue-200',
    tooltip: 'Tax calculated by external accounting system',
  },
  pending_external: {
    label: 'Tax: Pending',
    icon: Clock,
    className: 'bg-amber-100 text-amber-800 border-amber-200',
    tooltip: 'Tax awaiting import from external accounting system',
  },
};

const ADAPTER_NAMES: Record<string, string> = {
  quickbooks: 'QuickBooks Online',
  xero: 'Xero',
  sage: 'Sage',
};

export function InvoiceTaxSourceBadge({
  taxSource,
  externalAdapter,
  importedAt,
  className = '',
}: InvoiceTaxSourceBadgeProps) {
  const config = TAX_SOURCE_CONFIG[taxSource] || TAX_SOURCE_CONFIG.internal;
  const Icon = config.icon;

  let tooltipContent = config.tooltip;

  if (taxSource === 'external' && externalAdapter) {
    const adapterName = ADAPTER_NAMES[externalAdapter] || externalAdapter;
    tooltipContent = `Tax calculated by ${adapterName}`;
    if (importedAt) {
      tooltipContent += ` on ${new Date(importedAt).toLocaleDateString()}`;
    }
  }

  if (taxSource === 'pending_external' && externalAdapter) {
    const adapterName = ADAPTER_NAMES[externalAdapter] || externalAdapter;
    tooltipContent = `Awaiting tax calculation from ${adapterName}`;
  }

  return (
    <Tooltip content={tooltipContent}>
      <Badge
        variant="outline"
        className={`inline-flex items-center gap-1 ${config.className} ${className}`}
      >
        <Icon className="h-3 w-3" />
        <span className="text-xs">{config.label}</span>
      </Badge>
    </Tooltip>
  );
}

export default InvoiceTaxSourceBadge;
