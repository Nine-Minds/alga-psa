'use client';

import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { ColumnDefinition, IOpportunityListItem } from '@alga-psa/types';

const NUM_CELL = 'text-right tabular-nums';

/**
 * The Pipeline tab: a plain, fast table. The queue is where work happens;
 * this is where you find a deal. Stage text comes from evidence; staleness
 * shows as a badge, never a wall of red.
 */
export function PipelineList({
  items,
  onOpen,
  pagination,
}: {
  items: IOpportunityListItem[];
  onOpen: (opportunityId: string) => void;
  /** Server-side pagination handled by the host page. */
  pagination?: { currentPage: number; pageSize: number; totalItems: number; onPageChange: (page: number) => void };
}) {
  const { t } = useTranslation();
  const stageLabel = (stage: string) =>
    t(`opportunities.stage.${stage}`, stage.charAt(0).toUpperCase() + stage.slice(1));

  const columns: ColumnDefinition<IOpportunityListItem>[] = [
    {
      title: t('opportunities.list.deal', 'Deal'),
      dataIndex: 'title',
      render: (_v, record) => (
        <div>
          <div className="font-medium text-[rgb(var(--color-text-900))]">{record.title}</div>
          <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-500))]">
            {record.client_name}
            {record.client_lifecycle_status === 'prospect' ? (
              <Badge variant="default-muted" size="sm">{t('opportunities.prospect', 'Prospect')}</Badge>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      title: t('opportunities.list.stage', 'Stage'),
      dataIndex: 'stage',
      render: (_v, record) => (
        <span className="flex items-center gap-2">
          {record.status === 'won' ? (
            <Badge variant="success" size="sm">{t('opportunities.status.won', 'Won')}</Badge>
          ) : record.status === 'lost' ? (
            <Badge variant="error" size="sm">{t('opportunities.status.lost', 'Lost')}</Badge>
          ) : (
            <span className="text-sm">{stageLabel(record.stage)}</span>
          )}
          {record.is_stalled ? (
            <Badge variant="warning" size="sm">
              {t('opportunities.board.daysQuiet', '{{count}}d quiet', { count: record.days_since_activity })}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      title: t('opportunities.list.confidence', 'Confidence'),
      dataIndex: 'confidence',
      render: (v) => (
        <span className="text-sm text-[rgb(var(--color-text-700))]">
          {t(`opportunities.confidence.${v}`, String(v))}
        </span>
      ),
    },
    {
      title: <span className={NUM_CELL}>{t('opportunities.list.mrr', 'Recurring')}</span>,
      dataIndex: 'mrr_cents',
      render: (v, record) => (
        <span className={`block ${NUM_CELL}`}>
          {formatCurrencyFromMinorUnits(Number(v), undefined, record.currency_code)}
          {t('opportunities.perMonthSuffix', '/mo')}
        </span>
      ),
    },
    {
      title: <span className={NUM_CELL}>{t('opportunities.list.oneTime', 'One-time')}</span>,
      dataIndex: 'nrr_cents',
      render: (_v, record) => (
        <span className={`block ${NUM_CELL}`}>
          {formatCurrencyFromMinorUnits(record.nrr_cents + record.hardware_cents, undefined, record.currency_code)}
        </span>
      ),
    },
    {
      title: t('opportunities.list.nextAction', 'Next action'),
      dataIndex: 'next_action',
      render: (_v, record) =>
        record.next_action ? (
          <div className="max-w-52">
            <div className="truncate text-sm">{record.next_action}</div>
            {record.next_action_due ? (
              <div className="text-xs text-[rgb(var(--color-text-400))]">
                {t('opportunities.detail.due', 'due {{date}}', {
                  date: new Date(record.next_action_due).toLocaleDateString(),
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-[rgb(var(--color-text-400))]">—</span>
        ),
    },
    {
      title: t('opportunities.list.owner', 'Owner'),
      dataIndex: 'owner_name',
    },
  ];

  return (
    <DataTable
      id="opportunities-pipeline-table"
      data={items}
      columns={columns}
      onRowClick={(record: IOpportunityListItem) => onOpen(record.opportunity_id)}
      {...(pagination
        ? {
            currentPage: pagination.currentPage,
            pageSize: pagination.pageSize,
            totalItems: pagination.totalItems,
            onPageChange: pagination.onPageChange,
            manualPagination: true,
          }
        : {})}
    />
  );
}
