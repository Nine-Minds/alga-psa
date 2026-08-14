'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits, formatDateOnly } from '@alga-psa/core';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ColumnDefinition, IHourBlock } from '@alga-psa/types';
import { listHourBlocks } from '@alga-psa/billing/actions/hourBlockActions';
import SellHourBlockDialog from './SellHourBlockDialog';
import GrantHourBlockDialog from './GrantHourBlockDialog';
import AdjustHourBlockDialog from './AdjustHourBlockDialog';
import EditExpirationDialog from './EditExpirationDialog';
import VoidHourBlockDialog from './VoidHourBlockDialog';
import ManuallyExpireHourBlockDialog from './ManuallyExpireHourBlockDialog';
import HourBlockDetailDrawer from './HourBlockDetailDrawer';

const EXPIRING_SOON_DAYS = 7;

interface HourBlocksSectionProps {
  clientId: string;
  currencyCode?: string;
}

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function getStatusBadge(t: TranslateFn, block: IHourBlock) {
  switch (block.status) {
    case 'pending':
      return <Badge variant="default-muted">{t('status.pending', { defaultValue: 'Pending' })}</Badge>;
    case 'expired':
      return <Badge variant="error">{t('status.expired', { defaultValue: 'Expired' })}</Badge>;
    case 'voided':
      return <Badge variant="default-muted">{t('status.voided', { defaultValue: 'Voided' })}</Badge>;
    default:
      if (block.expiration_date) {
        const expDate = new Date(block.expiration_date);
        const days = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (days <= EXPIRING_SOON_DAYS) {
          return (
            <Badge variant="warning">
              {t('status.expiringSoon', { count: days, defaultValue: 'Expires in {{count}} days' })}
            </Badge>
          );
        }
      }
      return <Badge variant="success">{t('status.active', { defaultValue: 'Active' })}</Badge>;
  }
}

export default function HourBlocksSection({ clientId, currencyCode = 'USD' }: HourBlocksSectionProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [blocks, setBlocks] = useState<IHourBlock[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSellOpen, setIsSellOpen] = useState(false);
  const [isGrantOpen, setIsGrantOpen] = useState(false);
  const [adjustBlock, setAdjustBlock] = useState<IHourBlock | null>(null);
  const [expirationBlock, setExpirationBlock] = useState<IHourBlock | null>(null);
  const [expireBlock, setExpireBlock] = useState<IHourBlock | null>(null);
  const [voidBlock, setVoidBlock] = useState<IHourBlock | null>(null);
  const [detailBlock, setDetailBlock] = useState<IHourBlock | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await listHourBlocks(clientId);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setBlocks([]);
        setLoadError(t('section.loadFailed', { defaultValue: 'Failed to load hour blocks. Try again.' }));
        return;
      }
      setBlocks(result);
    } catch (err) {
      console.error('Failed to load hour blocks:', err);
      setBlocks([]);
      setLoadError(t('section.loadFailed', { defaultValue: 'Failed to load hour blocks. Try again.' }));
    }
  }, [clientId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => {
    load();
  }, [load]);

  const columns: ColumnDefinition<IHourBlock>[] = [
    {
      title: t('columns.block', { defaultValue: 'Block' }),
      dataIndex: 'service_name',
      render: (value: string | undefined, record) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[rgb(var(--color-text-900))]">
            {value || record.service_id}
          </p>
          {record.notes ? (
            <p className="truncate text-xs text-[rgb(var(--color-text-500))]">{record.notes}</p>
          ) : null}
        </div>
      ),
    },
    {
      title: t('columns.remaining', { defaultValue: 'Remaining' }),
      dataIndex: 'remaining_minutes',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (value: number, record) => {
        const remaining = Number(value);
        const total = Number(record.total_minutes);
        const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
              {(remaining / 60).toFixed(1)} / {(total / 60).toFixed(1)} hrs
            </span>
            <div className="h-1.5 w-24 rounded-full bg-[rgb(var(--color-border-100))]">
              <div
                className="h-1.5 rounded-full bg-[rgb(var(--color-primary-500))]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      title: t('columns.value', { defaultValue: 'Value' }),
      dataIndex: 'remaining_value',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
      render: (value: number, record) => (
        <span className="text-sm text-[rgb(var(--color-text-900))]">
          {formatCurrencyFromMinorUnits(Number(value ?? 0), undefined, record.currency_code || currencyCode)}
        </span>
      ),
    },
    {
      title: t('columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (_value: string, record) => getStatusBadge(t, record),
    },
    {
      title: t('columns.expiration', { defaultValue: 'Expiration' }),
      dataIndex: 'expiration_date',
      render: (value: string | null | undefined) => {
        if (!value) {
          return <span className="text-sm text-[rgb(var(--color-text-500))]">{t('status.never', { defaultValue: 'Never' })}</span>;
        }
        return <span className="text-sm text-[rgb(var(--color-text-900))]">{formatDateOnly(new Date(value))}</span>;
      },
    },
    {
      title: t('columns.source', { defaultValue: 'Source' }),
      dataIndex: 'source_invoice_id',
      render: (value: string | null | undefined, record) => {
        if (record.invoice_number) {
          return (
            <span className="text-sm text-[rgb(var(--color-text-900))]">
              {t('detail.sourceInvoice', { defaultValue: 'Invoice' })} #{record.invoice_number}
            </span>
          );
        }
        return (
          <span className="text-sm text-[rgb(var(--color-text-500))]">
            {t('detail.directGrant', { defaultValue: 'Direct grant' })}
          </span>
        );
      },
    },
    {
      title: t('columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'block_id',
      cellClassName: 'whitespace-nowrap',
      render: (value: string, record) => {
        const actionable = record.status === 'active' || record.status === 'pending';
        return (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" id={`hb-view-${value}`} onClick={(e) => { e.stopPropagation(); setDetailBlock(record); }}>
              {t('actions.viewDetails', { defaultValue: 'View details' })}
            </Button>
            {actionable && (
              <>
                <Button variant="outline" size="sm" id={`hb-adjust-${value}`} onClick={(e) => { e.stopPropagation(); setAdjustBlock(record); }}>
                  {t('actions.adjust', { defaultValue: 'Adjust hours' })}
                </Button>
                <Button variant="outline" size="sm" id={`hb-expiration-${value}`} onClick={(e) => { e.stopPropagation(); setExpirationBlock(record); }}>
                  {t('actions.editExpiration', { defaultValue: 'Edit expiration' })}
                </Button>
                {record.status === 'active' && (
                  <Button variant="outline" size="sm" id={`hb-expire-${value}`} className="text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); setExpireBlock(record); }}>
                    {t('actions.expire', { defaultValue: 'Expire' })}
                  </Button>
                )}
                {!record.has_allocations && (
                  <Button variant="outline" size="sm" id={`hb-void-${value}`} className="text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); setVoidBlock(record); }}>
                    {t('actions.void', { defaultValue: 'Void' })}
                  </Button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Card id="hour-blocks-section" className="bg-[rgb(var(--color-card))]">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t('section.title', { defaultValue: 'Hour Blocks' })}</CardTitle>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
              {t('section.description', { defaultValue: 'One-time prepaid hour blocks. Time that isn\'t covered by a contract line draws down these blocks, oldest expiration first.' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button id="hb-sell-button" onClick={() => setIsSellOpen(true)}>
              {t('actions.sell', { defaultValue: 'Sell block' })}
            </Button>
            <Button id="hb-grant-button" variant="outline" onClick={() => setIsGrantOpen(true)}>
              {t('actions.grant', { defaultValue: 'Grant block' })}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loadError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {blocks === null ? (
          <Skeleton className="h-48 w-full" />
        ) : blocks.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('section.noBlocks', { defaultValue: 'No hour blocks yet. Sell a block to this client or grant comped hours.' })}
            </p>
          </div>
        ) : (
          <DataTable
            id="hour-blocks-table"
            columns={columns}
            data={blocks}
            onRowClick={(record: IHourBlock) => setDetailBlock(record)}
          />
        )}
      </CardContent>

      <SellHourBlockDialog
        clientId={clientId}
        currencyCode={currencyCode}
        isOpen={isSellOpen}
        onClose={() => setIsSellOpen(false)}
        onCreated={reload}
      />
      <GrantHourBlockDialog
        clientId={clientId}
        isOpen={isGrantOpen}
        onClose={() => setIsGrantOpen(false)}
        onCreated={reload}
      />
      <AdjustHourBlockDialog block={adjustBlock} onClose={() => setAdjustBlock(null)} onChanged={reload} />
      <EditExpirationDialog block={expirationBlock} onClose={() => setExpirationBlock(null)} onChanged={reload} />
      <ManuallyExpireHourBlockDialog block={expireBlock} onClose={() => setExpireBlock(null)} onChanged={reload} />
      <VoidHourBlockDialog block={voidBlock} onClose={() => setVoidBlock(null)} onChanged={reload} />
      <HourBlockDetailDrawer block={detailBlock} onClose={() => setDetailBlock(null)} />
    </Card>
  );
}
