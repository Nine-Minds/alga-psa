import type { ReportDefinition } from '../../core/types';

export const opportunityAssessmentConversionReport: ReportDefinition = {
  id: 'opportunities.assessment_conversion',
  name: 'Opportunity Assessment Conversion',
  description: 'Won rate for closed opportunities with an assessment checkpoint compared with those without one',
  category: 'analytics',
  version: '1.0.0',
  permissions: {
    roles: ['admin', 'account_manager'],
    resources: ['opportunities.read'],
  },
  metrics: [{
    id: 'assessment_conversion',
    name: 'Assessment Conversion',
    type: 'ratio',
    query: {
      table: 'raw_sql',
      fields: [`
        SELECT
          CASE WHEN assessment.opportunity_id IS NULL THEN 'without_assessment' ELSE 'with_assessment' END AS assessment_group,
          COUNT(*)::bigint AS closed_count,
          COUNT(*) FILTER (WHERE opportunity.status = 'won')::bigint AS won_count,
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE COUNT(*) FILTER (WHERE opportunity.status = 'won')::numeric / COUNT(*)::numeric
          END AS won_rate
        FROM {{tenant_table:opportunities AS opportunity}}
        LEFT JOIN (
          SELECT DISTINCT opportunity_id
          FROM {{tenant_table:opportunity_evidence AS evidence}}
          WHERE evidence.checkpoint = 'assessment'
            AND evidence.corrected_at IS NULL
        ) AS assessment ON assessment.opportunity_id = opportunity.opportunity_id
        WHERE opportunity.status IN ('won', 'lost')
        GROUP BY CASE WHEN assessment.opportunity_id IS NULL THEN 'without_assessment' ELSE 'with_assessment' END
        ORDER BY assessment_group
      `],
      filters: [],
    },
  }],
  caching: {
    ttl: 300,
    key: 'opportunities.assessment_conversion.{{tenant}}',
    invalidateOn: ['opportunities.updated', 'opportunity_evidence.created'],
  },
};
