import { describe, expect, it } from 'vitest';
import {
  declaredOpportunityEvidenceApiSchema,
  opportunityListQuerySchema,
  winOpportunityApiSchema,
} from '../../../lib/api/schemas/opportunitySchemas';

describe('opportunity REST schemas', () => {
  it('parses the contract list filters and caps page size', () => {
    expect(opportunityListQuerySchema.parse({
      status: 'open',
      stage: 'qualified',
      owner_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      opportunity_type: 'expansion',
      stalled_only: 'true',
      search: 'assessment',
      page: '2',
      page_size: '500',
      sort_by: 'last_activity_at',
      sort_direction: 'desc',
    })).toEqual({
      status: 'open',
      stage: 'qualified',
      owner_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      opportunity_type: 'expansion',
      stalled_only: true,
      search: 'assessment',
      page: 2,
      page_size: 100,
      sort_by: 'last_activity_at',
      sort_direction: 'desc',
    });
  });

  it('rejects unwhitelisted sorts and non-contract declared checkpoints', () => {
    expect(opportunityListQuerySchema.safeParse({ sort_by: 'title; DROP TABLE opportunities' }).success).toBe(false);
    expect(declaredOpportunityEvidenceApiSchema.safeParse({ checkpoint: 'assessment' }).success).toBe(false);
    expect(declaredOpportunityEvidenceApiSchema.safeParse({ checkpoint: 'qualified' }).success).toBe(true);
  });

  it('accepts close-won conversion options as UUIDs', () => {
    expect(winOpportunityApiSchema.parse({
      convert_quote_id: '11111111-1111-4111-8111-111111111111',
      project_template_id: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      convert_quote_id: '11111111-1111-4111-8111-111111111111',
      project_template_id: '22222222-2222-4222-8222-222222222222',
    });
  });
});
