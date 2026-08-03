'use client';

import { DataTable } from '@alga-psa/ui/components/DataTable';
import Link from 'next/link';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { ColumnDefinition, IOpportunityListItem, OpportunityStage } from '@alga-psa/types';
import { OPPORTUNITY_STAGE_LABELS } from '../../lib/opportunityStages';
import { oneTimeCents } from '../../lib/pipelineReporting';

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
  initialStage,
}: {
  items: IOpportunityListItem[];
  onOpen: (opportunityId: string) => void;
  /** Server-side pagination handled by the host page. */
  pagination?: { currentPage: number; pageSize: number; totalItems: number; onPageChange: (page: number) => void };
  initialStage?: OpportunityStage;
}) {
  const { t } = useTranslation('msp/opportunities');
  const stageLabel = (stage: OpportunityStage) => {
    const label = OPPORTUNITY_STAGE_LABELS[stage];
    return t(label.key, label.fallback);
  };

  const columns: ColumnDefinition<IOpportunityListItem>[] = [
    {
      title: t('opportunities.list.deal', 'Deal'),
      dataIndex: 'title',
      render: (_v, record) => (
        <div>
          <div className="font-medium text-[rgb(var(--color-text-900))]">{record.title}</div>
          <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-500))]">
            <Link
              href={`/msp/clients/${record.client_id}`}
              className="text-[rgb(var(--color-primary-600))] hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {record.client_name}
            </Link>
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
          {formatCurrencyFromMinorUnits(oneTimeCents(record), undefined, record.currency_code)}
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
  const visibleItems = initialStage ? items.filter((item) => item.stage === initialStage) : items;

  return (
    <DataTable
      id="opportunities-pipeline-table"
      data={visibleItems}
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
