import type { ReportDefinition } from '../../core/types';

export const opportunityPipelineByStageReport: ReportDefinition = {
  id: 'opportunities.pipeline_by_stage',
  name: 'Opportunity Pipeline by Stage',
  description: 'Open opportunity count and value by evidence-derived stage, owner, type, and currency',
  category: 'analytics',
  version: '1.0.0',
  permissions: {
    roles: ['admin', 'account_manager'],
    resources: ['opportunities.read'],
  },
  metrics: [{
    id: 'pipeline_by_stage',
    name: 'Pipeline by Stage',
    type: 'count',
    query: {
      table: 'opportunities',
      joins: [{
        type: 'left',
        table: 'users',
        on: [
          { left: 'opportunities.owner_id', right: 'users.user_id' },
          { left: 'opportunities.tenant', right: 'users.tenant' },
        ],
      }],
      fields: [
        'opportunities.stage',
        'opportunities.owner_id',
        "CONCAT_WS(' ', users.first_name, users.last_name) AS owner_name",
        'opportunities.opportunity_type',
        'opportunities.currency_code',
        'COUNT(*)::bigint AS opportunity_count',
        'COALESCE(SUM(opportunities.mrr_cents), 0)::bigint AS mrr_cents',
        'COALESCE(SUM(opportunities.nrr_cents), 0)::bigint AS nrr_cents',
        'COALESCE(SUM(opportunities.hardware_cents), 0)::bigint AS hardware_cents',
      ],
      filters: [{ field: 'opportunities.status', operator: 'eq', value: 'open' }],
      groupBy: [
        'opportunities.stage',
        'opportunities.owner_id',
        'users.first_name',
        'users.last_name',
        'opportunities.opportunity_type',
        'opportunities.currency_code',
      ],
      orderBy: [{ field: 'opportunities.stage', direction: 'asc' }],
    },
  }],
  caching: {
    ttl: 300,
    key: 'opportunities.pipeline_by_stage.{{tenant}}',
    invalidateOn: ['opportunities.created', 'opportunities.updated'],
  },
};
