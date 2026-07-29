'use client';

import { Check, Clock3, ExternalLink } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition, IQueueActionItem } from '@alga-psa/types';
import { opportunityValueParts } from '../../lib/format';

export function QueueActionsTable({
  items,
  onComplete,
  onOpen,
  onSnooze,
}: {
  items: IQueueActionItem[];
  onComplete: (opportunityId: string, stage: IQueueActionItem['stage']) => void;
  onOpen: (opportunityId: string) => void;
  onSnooze: (opportunityId: string) => void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const columns: ColumnDefinition<IQueueActionItem>[] = [
    {
      title: t('opportunities.queue.table.nextAction', 'Next action'),
      dataIndex: 'next_action',
      render: (_value, item) => (
        <div className="min-w-40">
          <div className="font-medium text-[rgb(var(--color-text-900))]">
            {item.next_action ?? item.title}
          </div>
          <div className="text-xs text-[rgb(var(--color-text-500))]">{item.title}</div>
        </div>
      ),
    },
    {
      title: t('opportunities.queue.table.client', 'Client'),
      dataIndex: 'client_name',
    },
    {
      title: t('opportunities.queue.table.value', 'Value'),
      dataIndex: 'mrr_cents',
      render: (_value, item) => {
        const value = opportunityValueParts(
          item.mrr_cents,
          item.nrr_cents,
          item.hardware_cents,
          item.currency_code,
        );
        return (
          <span className="whitespace-nowrap tabular-nums">
            {value.amount}
            {value.recurring ? t('opportunities.perMonthSuffix', '/mo') : ''}
          </span>
        );
      },
    },
    {
      title: t('opportunities.queue.table.due', 'Due'),
      dataIndex: 'next_action_due',
      render: (_value, item) => item.days_overdue > 0 ? (
        <Badge variant="error" size="sm">
          {t('opportunities.queue.daysOverdue', '{{count}} days overdue', { count: item.days_overdue })}
        </Badge>
      ) : item.kind === 'going_quiet' ? (
        <Badge variant="warning" size="sm">
          {t('opportunities.queue.daysQuiet', '{{count}} days quiet', { count: item.days_since_activity })}
        </Badge>
      ) : item.next_action_due ? (
        <span className="whitespace-nowrap text-xs text-[rgb(var(--color-text-500))]">
          {new Date(item.next_action_due).toLocaleDateString()}
        </span>
      ) : '—',
    },
    {
      title: t('opportunities.queue.table.actions', 'Actions'),
      dataIndex: 'opportunity_id',
      render: (_value, item) => {
        const id = `opportunity-queue-table-${item.opportunity_id}`;
        return (
          <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
            <Button
              id={`${id}-complete`}
              size="xs"
              variant={item.is_screen_primary ? 'default' : 'soft'}
              aria-label={t('opportunities.queue.completeActionFor', 'Complete action for {{title}}', { title: item.title })}
              onClick={() => onComplete(item.opportunity_id, item.stage)}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              id={`${id}-open`}
              size="xs"
              variant="ghost"
              aria-label={t('opportunities.queue.openDealNamed', 'Open {{title}}', { title: item.title })}
              onClick={() => onOpen(item.opportunity_id)}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              id={`${id}-snooze`}
              size="xs"
              variant="ghost"
              aria-label={t('opportunities.queue.snoozeNamed', 'Snooze {{title}}', { title: item.title })}
              onClick={() => onSnooze(item.opportunity_id)}
            >
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      id="opportunities-queue-table"
      data={items}
      columns={columns}
      onRowClick={(item: IQueueActionItem) => onOpen(item.opportunity_id)}
    />
  );
}
