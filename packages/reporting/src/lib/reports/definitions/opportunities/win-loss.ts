import type { ReportDefinition } from '../../core/types';

export const opportunityWinLossReport: ReportDefinition = {
  id: 'opportunities.win_loss',
  name: 'Opportunity Win/Loss',
  description: 'Closed opportunity outcomes with loss reason and competitor detail',
  category: 'analytics',
  version: '1.0.0',
  permissions: {
    roles: ['admin', 'account_manager'],
    resources: ['opportunities.read'],
  },
  metrics: [
    {
      id: 'outcomes',
      name: 'Closed Outcomes',
      type: 'count',
      query: {
        table: 'opportunities',
        fields: [
          'status',
          'currency_code',
          'COUNT(*)::bigint AS opportunity_count',
          'COALESCE(SUM(mrr_cents), 0)::bigint AS mrr_cents',
          'COALESCE(SUM(nrr_cents), 0)::bigint AS nrr_cents',
        ],
        filters: [{ field: 'status', operator: 'in', value: ['won', 'lost'] }],
        groupBy: ['status', 'currency_code'],
      },
    },
    {
      id: 'loss_breakdown',
      name: 'Loss Breakdown',
      type: 'count',
      query: {
        table: 'opportunities',
        fields: [
          'loss_reason',
          'lost_to',
          'currency_code',
          'COUNT(*)::bigint AS opportunity_count',
          'COALESCE(SUM(mrr_cents), 0)::bigint AS mrr_cents',
          'COALESCE(SUM(nrr_cents), 0)::bigint AS nrr_cents',
        ],
        filters: [{ field: 'status', operator: 'eq', value: 'lost' }],
        groupBy: ['loss_reason', 'lost_to', 'currency_code'],
        orderBy: [{ field: 'loss_reason', direction: 'asc' }],
      },
    },
  ],
  caching: {
    ttl: 300,
    key: 'opportunities.win_loss.{{tenant}}',
    invalidateOn: ['opportunities.updated'],
  },
};
