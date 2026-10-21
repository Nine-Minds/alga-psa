import type { ReportDefinition } from '../../core/types';

export const opportunityGeneratorYieldReport: ReportDefinition = {
  id: 'opportunities.generator_yield',
  name: 'Opportunity Generator Yield',
  description: 'Suggestion creation, acceptance, and won opportunity yield by generator and currency',
  category: 'analytics',
  version: '1.0.0',
  permissions: {
    roles: ['admin', 'account_manager'],
    resources: ['opportunities.read'],
  },
  metrics: [{
    id: 'generator_yield',
    name: 'Generator Yield',
    type: 'count',
    query: {
      table: 'raw_sql',
      fields: [`
        SELECT
          suggestion.generator_key,
          suggestion.currency_code,
          COUNT(*)::bigint AS suggestions_created,
          COUNT(*) FILTER (WHERE suggestion.status = 'accepted')::bigint AS suggestions_accepted,
          COUNT(*) FILTER (WHERE opportunity.status = 'won')::bigint AS opportunities_won,
          COALESCE(SUM(suggestion.mrr_cents), 0)::bigint AS created_mrr_cents,
          COALESCE(SUM(suggestion.nrr_cents), 0)::bigint AS created_nrr_cents,
          COALESCE(SUM(suggestion.mrr_cents) FILTER (WHERE suggestion.status = 'accepted'), 0)::bigint AS accepted_mrr_cents,
          COALESCE(SUM(suggestion.nrr_cents) FILTER (WHERE suggestion.status = 'accepted'), 0)::bigint AS accepted_nrr_cents,
          COALESCE(SUM(opportunity.mrr_cents) FILTER (WHERE opportunity.status = 'won'), 0)::bigint AS won_mrr_cents,
          COALESCE(SUM(opportunity.nrr_cents) FILTER (WHERE opportunity.status = 'won'), 0)::bigint AS won_nrr_cents
        FROM {{tenant_table:opportunity_suggestions AS suggestion}}
        LEFT JOIN {{tenant_table:opportunities AS opportunity}}
          ON opportunity.opportunity_id = suggestion.created_opportunity_id
        GROUP BY suggestion.generator_key, suggestion.currency_code
        ORDER BY suggestion.generator_key, suggestion.currency_code
      `],
      filters: [],
    },
  }],
  caching: {
    ttl: 300,
    key: 'opportunities.generator_yield.{{tenant}}',
    invalidateOn: ['opportunity_suggestions.created', 'opportunity_suggestions.updated', 'opportunities.updated'],
  },
};
