'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Clock } from 'lucide-react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCalendarDate, formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type {
  ClientPortalHourBlock,
  ClientPortalHourBlockBurnEntry,
} from '../../actions/client-portal-actions/client-billing';

function isActionError(value: unknown): boolean {
  const candidate = value as Record<string, unknown> | null;
  return (
    typeof value === 'object' &&
    value !== null &&
    candidate !== null &&
    (typeof candidate.actionError === 'string' || typeof candidate.permissionError === 'string')
  );
}

/**
 * "Hour blocks" card for the portal billing overview: prepaid-hour-block rows
 * with remaining meters, expiration, and a recent-burn list. Renders nothing
 * unless the client has at least one active block.
 */
export default function HourBlocksCard() {
  const { t } = useTranslation('features/billing');
  const { locale } = useFormatters();
  const [blocks, setBlocks] = useState<ClientPortalHourBlock[] | null>(null);
  const [burnHistory, setBurnHistory] = useState<ClientPortalHourBlockBurnEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getClientHourBlocks, getClientHourBlockBurnHistory } = await import(
          '../../actions/client-portal-actions/client-billing'
        );
        const [blockResult, burnResult] = await Promise.all([
          getClientHourBlocks(),
          getClientHourBlockBurnHistory(),
        ]);
        if (cancelled) return;
        if (!isActionError(blockResult)) {
          setBlocks(blockResult as ClientPortalHourBlock[]);
        }
        if (!isActionError(burnResult)) {
          setBurnHistory(burnResult as ClientPortalHourBlockBurnEntry[]);
        }
      } catch (error) {
        console.error('Error loading hour blocks card:', error);
        if (!cancelled) setBlocks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <Card id="hour-blocks-card" className="p-6">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-500">
            {t('hourBlocks.title', 'Prepaid Hour Blocks')}
          </p>
          {blocks.length === 0 ? (
            <Skeleton className="mt-2 h-8 w-3/4" />
          ) : (
            <ul className="mt-3 space-y-3">
              {blocks.map((block) => {
                const fillPercent = block.hours_total > 0
                  ? Math.max(0, Math.min(100, ((block.hours_total - block.hours_remaining) / block.hours_total) * 100))
                  : 0;
                return (
                  <li key={block.block_id} className="rounded-md border border-[rgb(var(--color-border-100))] p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[rgb(var(--color-text-900))]">
                        {t('hourBlocks.blockLabel', { service: block.service_name, defaultValue: '{{service}} block' })}
                      </span>
                      {block.expiring_soon_days != null ? (
                        <Badge variant="warning" size="sm" className="shrink-0">
                          {t('hourBlocks.expiringSoon', { days: block.expiring_soon_days, defaultValue: 'Expires in {{days}}d' })}
                        </Badge>
                      ) : (
                        <span className="shrink-0 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                          {t('hourBlocks.hoursLeft', { hours: block.hours_remaining.toFixed(1), defaultValue: '{{hours}}h left' })}
                        </span>
                      )}
                    </div>
                    {block.contract_name && (
                      <p
                        id={`hour-block-contract-${block.block_id}`}
                        className="truncate text-xs text-gray-500"
                      >
                        {t('hourBlocks.contractLabel', {
                          contract: block.contract_name,
                          defaultValue: 'Contract: {{contract}}',
                        })}
                      </p>
                    )}
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200">
                      <div
                        className="h-1.5 rounded-full bg-[rgb(var(--color-primary-500))]"
                        style={{ width: `${fillPercent}%` }}
                      ></div>
                    </div>
                    {block.remaining_value > 0 && block.currency_code && (
                      <p id={`hour-block-remaining-${block.block_id}`} className="mt-1 text-xs text-gray-500">
                        {t('hourBlocks.hoursLeftValue', {
                          hours: block.hours_remaining.toFixed(1),
                          value: formatCurrencyFromMinorUnits(block.remaining_value, locale, block.currency_code),
                          defaultValue: '{{hours}}h left · {{value}}',
                        })}
                      </p>
                    )}
                    {block.valid_from && (
                      <p id={`hour-block-valid-from-${block.block_id}`} className="mt-1 text-xs text-gray-500">
                        {t('hourBlocks.validFrom', { date: formatCalendarDate(block.valid_from) ?? '', defaultValue: 'Valid from {{date}}' })}
                      </p>
                    )}
                    {block.expiration_date && (
                      <p className="mt-1 text-xs text-gray-500">
                        {t('hourBlocks.expires', { date: formatCalendarDate(block.expiration_date) ?? '', defaultValue: 'Expires {{date}}' })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {burnHistory.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-500">
                {t('hourBlocks.recentBurn', 'Recent usage')}
              </p>
              <ul className="mt-2 space-y-1.5">
                {burnHistory.slice(0, 5).map((entry) => (
                  <li key={entry.allocation_id} className="flex items-center justify-between gap-2 text-sm text-gray-600">
                    <span className="truncate">
                      {entry.work_item_title || t('hourBlocks.timeEntry', 'Time entry')}
                      {entry.entry_date ? ` · ${formatCalendarDate(entry.entry_date) ?? ''}` : ''}
                      {entry.contract_name ? ` · ${entry.contract_name}` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums">-{entry.hours.toFixed(1)}h</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Clock className="h-5 w-5 text-gray-400" />
      </div>
    </Card>
  );
}
