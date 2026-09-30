import { describe, expect, it } from 'vitest';
import {
  createOpportunityApiSchema,
  declaredOpportunityEvidenceApiSchema,
  opportunityListQuerySchema,
  setOpportunityStageApiSchema,
  updateOpportunityApiSchema,
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

  it('rejects unwhitelisted sorts and accepts only declared stage checkpoints', () => {
    expect(opportunityListQuerySchema.safeParse({ sort_by: 'title; DROP TABLE opportunities' }).success).toBe(false);
    expect(declaredOpportunityEvidenceApiSchema.safeParse({ checkpoint: 'not-a-stage' }).success).toBe(false);
    expect(declaredOpportunityEvidenceApiSchema.safeParse({ checkpoint: 'assessment' }).success).toBe(true);
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

  // A read-modify-write caller sends the whole GET body back. The fields owned
  // by dedicated flows have to survive parsing so the service can tell "echoed
  // unchanged" from "tried to change it" instead of dropping them silently.
  it('keeps the flow-owned fields on the update body instead of stripping them', () => {
    const parsed = updateOpportunityApiSchema.parse({
      title: 'Managed services expansion',
      stage: 'qualified',
      status: 'open',
      next_action: 'Review assessment',
      next_action_due: '2026-07-15T14:00:00.000Z',
      client_id: '22222222-2222-4222-8222-222222222222',
    });

    expect(parsed).toMatchObject({
      title: 'Managed services expansion',
      stage: 'qualified',
      status: 'open',
      next_action: 'Review assessment',
      next_action_due: '2026-07-15T14:00:00.000Z',
      client_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(updateOpportunityApiSchema.parse({})).toEqual({});
    expect(updateOpportunityApiSchema.safeParse({ stage: 'not-a-stage' }).success).toBe(false);
    expect(updateOpportunityApiSchema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('takes a stage plus optional detail and still validates the enum', () => {
    expect(setOpportunityStageApiSchema.parse({ stage: 'proposed' })).toEqual({ stage: 'proposed' });
    expect(setOpportunityStageApiSchema.parse({ stage: 'verbal', detail: '  Verbal yes  ' }))
      .toEqual({ stage: 'verbal', detail: 'Verbal yes' });
    // won/lost parse here and are refused by the service with a pointer to /win and /lose.
    expect(setOpportunityStageApiSchema.safeParse({ stage: 'won' }).success).toBe(true);
    expect(setOpportunityStageApiSchema.safeParse({ stage: 'nowhere' }).success).toBe(false);
  });

  // GET used to answer with a full ISO datetime, so anything coded against that
  // shape has to keep working when it writes the value back.
  it('accepts a datetime expected_close_date and truncates it to the calendar date', () => {
    expect(updateOpportunityApiSchema.parse({ expected_close_date: '2026-08-31T00:00:00.000Z' }))
      .toEqual({ expected_close_date: '2026-08-31' });
    expect(updateOpportunityApiSchema.parse({ expected_close_date: '2026-08-31' }))
      .toEqual({ expected_close_date: '2026-08-31' });
    expect(updateOpportunityApiSchema.parse({ expected_close_date: null }))
      .toEqual({ expected_close_date: null });
    expect(updateOpportunityApiSchema.safeParse({ expected_close_date: '08/31/2026' }).success).toBe(false);

    expect(createOpportunityApiSchema.parse({
      client_id: '22222222-2222-4222-8222-222222222222',
      title: 'Renewal',
      opportunity_type: 'renewal',
      currency_code: 'USD',
      expected_close_date: '2026-08-31T12:30:00.000Z',
      next_action: 'Confirm renewal terms',
      next_action_due: '2026-07-15T14:00:00.000Z',
    }).expected_close_date).toBe('2026-08-31');
  });
});
