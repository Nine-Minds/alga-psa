'use client';

import { useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useClientDrawer } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { ColumnDefinition, IOpportunityListItem, OpportunityStage } from '@alga-psa/types';
import { updateOpportunity } from '../../actions/opportunityActions';
import { OPPORTUNITY_STAGE_LABELS } from '../../lib/opportunityStages';
import { oneTimeCents } from '../../lib/pipelineReporting';
import { EditValuesDialog } from '../dialogs/EditValuesDialog';

const NUM_CELL = 'text-right tabular-nums';

/**
 * The Pipeline tab: a plain, fast table. The queue is where work happens;
 * this is where you find a deal. Stage text comes from evidence; staleness
 * shows as a badge, never a wall of red. Value cells edit in place so a
 * number can be fixed straight after a client call.
 */
export function PipelineList({
  items,
  onOpen,
  pagination,
  initialStage,
  onValuesChanged,
}: {
  items: IOpportunityListItem[];
  onOpen: (opportunityId: string) => void;
  /** Server-side pagination handled by the host page. */
  pagination?: { currentPage: number; pageSize: number; totalItems: number; onPageChange: (page: number) => void };
  initialStage?: OpportunityStage;
  /** Called after an inline value edit so the host can refresh its rows. */
  onValuesChanged?: () => void | Promise<void>;
}) {
  const { t } = useTranslation('msp/opportunities');
  const clientDrawer = useClientDrawer();
  const [editing, setEditing] = useState<IOpportunityListItem | null>(null);
  const stageLabel = (stage: OpportunityStage) => {
    const label = OPPORTUNITY_STAGE_LABELS[stage];
    return t(label.key, label.fallback);
  };

  const editableValue = (record: IOpportunityListItem, content: React.ReactNode) => {
    const locked = record.status !== 'open' || record.values_locked_by_quote;
    if (locked) return <span className={`block ${NUM_CELL}`}>{content}</span>;
    return (
      <Button
        id={`opportunity-pipeline-value-${record.opportunity_id}`}
        variant="ghost"
        size="xs"
        className={`h-auto w-full justify-end px-1 py-0.5 font-normal ${NUM_CELL}`}
        title={t('opportunities.list.editValues', 'Edit value')}
        onClick={(event) => {
          event.stopPropagation();
          setEditing(record);
        }}
      >
        {content}
      </Button>
    );
  };

  const columns: ColumnDefinition<IOpportunityListItem>[] = [
    {
      title: t('opportunities.list.deal', 'Deal'),
      dataIndex: 'title',
      render: (_v, record) => (
        <div>
          <div className="font-medium text-[rgb(var(--color-text-900))]">{record.title}</div>
          <div className="flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-500))]">
            {clientDrawer ? (
              <Button
                id={`opportunity-pipeline-client-${record.opportunity_id}`}
                variant="link"
                size="xs"
                className="h-auto px-0 py-0 text-xs font-normal"
                onClick={(event) => {
                  event.stopPropagation();
                  clientDrawer.openClientDrawer(record.client_id);
                }}
              >
                {record.client_name}
              </Button>
            ) : (
              <Link
                href={`/msp/clients/${record.client_id}`}
                className="text-[rgb(var(--color-primary-600))] hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {record.client_name}
              </Link>
            )}
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
      render: (v, record) => editableValue(record, (
        <>
          {formatCurrencyFromMinorUnits(Number(v), undefined, record.currency_code)}
          {t('opportunities.perMonthSuffix', '/mo')}
        </>
      )),
    },
    {
      title: <span className={NUM_CELL}>{t('opportunities.list.oneTime', 'One-time')}</span>,
      dataIndex: 'nrr_cents',
      render: (_v, record) => editableValue(
        record,
        formatCurrencyFromMinorUnits(oneTimeCents(record), undefined, record.currency_code),
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
    <>
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
      {editing ? (
        <EditValuesDialog
          key={editing.opportunity_id}
          isOpen
          onClose={() => setEditing(null)}
          currencyCode={editing.currency_code}
          initial={{
            mrr_cents: editing.mrr_cents,
            nrr_cents: editing.nrr_cents,
            hardware_cents: editing.hardware_cents,
          }}
          onSubmit={async (values) => {
            try {
              await updateOpportunity(editing.opportunity_id, values);
              toast.success(t('opportunities.toast.valuesSaved', 'Value updated'));
              await onValuesChanged?.();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
              throw err;
            }
          }}
        />
      ) : null}
    </>
  );
}
