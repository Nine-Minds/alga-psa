'use client';

import { useEffect, useState } from 'react';
import Drawer from '@alga-psa/ui/components/Drawer';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCalendarDate, formatDateOnly } from '@alga-psa/core';
import type { IHourBlock, IHourBlockAllocation, IHourBlockAuditEntry } from '@alga-psa/types';
import { getHourBlockDetail } from '@alga-psa/billing/actions/hourBlockActions';

interface HourBlockDetailDrawerProps {
  block: IHourBlock | null;
  onClose: () => void;
}

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function auditLabel(t: TranslateFn, entry: IHourBlockAuditEntry): string {
  switch (entry.type) {
    case 'purchase':
      return t('detail.purchaseLabel', { defaultValue: 'Purchased' });
    case 'grant':
      return t('detail.grantLabel', { defaultValue: 'Granted' });
    case 'adjustment':
      return t('detail.adjusted', { defaultValue: 'Adjusted' });
    case 'expiration_date_change':
      return t('detail.expirationChanged', { defaultValue: 'Expiration changed' });
    case 'manual_expiration':
      return t('detail.manuallyExpired', { defaultValue: 'Expired manually' });
    case 'auto_expiration':
      return t('detail.autoExpired', { defaultValue: 'Auto-expired' });
    case 'void':
      return t('detail.voidedLabel', { defaultValue: 'Voided' });
    case 'purchase_reversal':
      return t('detail.purchaseReversed', { defaultValue: 'Purchase reversed (invoice unfinalized)' });
    default:
      return entry.type;
  }
}

export default function HourBlockDetailDrawer({ block, onClose }: HourBlockDetailDrawerProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [data, setData] = useState<{
    block: IHourBlock;
    scopes: Array<{ service_id: string; service_name?: string }>;
    allocations: IHourBlockAllocation[];
    audit: IHourBlockAuditEntry[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!block) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getHourBlockDetail(block.block_id)
      .then((result) => {
        if (cancelled) return;
        if ('block' in result) {
          setData(result);
        }
      })
      .catch((err) => {
        console.error('Failed to load hour block detail:', err);
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [block]);

  const remainingHours = data ? Number(data.block.remaining_minutes) / 60 : 0;
  const usedHours = data ? (Number(data.block.total_minutes) - Number(data.block.remaining_minutes)) / 60 : 0;

  return (
    <Drawer isOpen={Boolean(block)} onClose={onClose} id="hour-block-detail-drawer" width="520px">
      <div className="space-y-6">
        {loading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                  {t('detail.title', { defaultValue: 'Hour block details' })}
                </h3>
                <Badge>{data.block.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                {data.block.service_name ?? data.block.service_id}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-md bg-[rgb(var(--color-border-100))] p-3">
                <p className="text-xs text-[rgb(var(--color-text-500))]">{t('detail.total', { defaultValue: 'Total' })}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                  {(Number(data.block.total_minutes) / 60).toFixed(1)} hrs
                </p>
              </div>
              <div className="rounded-md bg-[rgb(var(--color-border-100))] p-3">
                <p className="text-xs text-[rgb(var(--color-text-500))]">{t('detail.remaining', { defaultValue: 'Remaining' })}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                  {remainingHours.toFixed(1)} hrs
                </p>
              </div>
              <div className="rounded-md bg-[rgb(var(--color-border-100))] p-3">
                <p className="text-xs text-[rgb(var(--color-text-500))]">{t('detail.used', { defaultValue: 'Used' })}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                  {usedHours.toFixed(1)} hrs
                </p>
              </div>
            </div>

            <div className="space-y-1.5 text-sm">
              <p className="text-[rgb(var(--color-text-500))]">
                {t('detail.scopeLabel', { defaultValue: 'Scope' })}:{' '}
                <span className="text-[rgb(var(--color-text-900))]">
                  {data.scopes.length === 0
                    ? t('detail.allLabor', { defaultValue: 'All labor' })
                    : data.scopes.map((scope) => scope.service_name ?? scope.service_id).join(', ')}
                </span>
              </p>
              {data.block.expiration_date && (
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('detail.expires', { date: formatCalendarDate(data.block.expiration_date) ?? '', defaultValue: 'Expires {{date}}' })}
                </p>
              )}
              {data.block.source_invoice_id && data.block.invoice_number ? (
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('detail.sourceInvoice', { defaultValue: 'Source invoice' })} #{data.block.invoice_number}
                </p>
              ) : data.block.source_type === 'purchase' ? (
                <p className="text-[rgb(var(--color-text-500))]">
                  {t('detail.invoiceDeleted', { defaultValue: 'Invoice (deleted)' })}
                </p>
              ) : (
                <p className="text-[rgb(var(--color-text-500))]">{t('detail.directGrant', { defaultValue: 'Direct grant' })}</p>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                {t('detail.burnHistory', { defaultValue: 'Burn history' })}
              </h4>
              {data.allocations.length === 0 ? (
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('detail.noBurn', { defaultValue: 'No time has been drawn from this block yet.' })}
                </p>
              ) : (
                <ul className="divide-y divide-[rgb(var(--color-border-100))] rounded-md border border-[rgb(var(--color-border-100))]">
                  {data.allocations.map((allocation) => (
                    <li key={allocation.allocation_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[rgb(var(--color-text-900))]">
                          {(allocation.minutes / 60).toFixed(1)} hrs
                        </p>
                        <p className="truncate text-xs text-[rgb(var(--color-text-500))]">
                          {allocation.user_name ?? ''}{allocation.entry_date ? ` · ${formatCalendarDate(allocation.entry_date) ?? ''}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                {t('detail.audit', { defaultValue: 'Audit trail' })}
              </h4>
              {data.audit.length === 0 ? (
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('detail.noAudit', { defaultValue: 'No audit entries.' })}
                </p>
              ) : (
                <ul className="divide-y divide-[rgb(var(--color-border-100))] rounded-md border border-[rgb(var(--color-border-100))]">
                  {data.audit.map((entry) => (
                    <li key={entry.audit_id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-[rgb(var(--color-text-900))]">{auditLabel(t, entry)}</p>
                        {entry.reason && (
                          <p className="mt-0.5 text-xs text-[rgb(var(--color-text-500))]">{entry.reason}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-[rgb(var(--color-text-500))]">
                        {formatDateOnly(new Date(entry.created_at))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
