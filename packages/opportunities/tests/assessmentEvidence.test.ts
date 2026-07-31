import { describe, expect, it, vi } from 'vitest';
import type { IQuote } from '@alga-psa/types';
import { recordAssessmentEvidenceForAcceptedQuote } from '../src/lib/quoteLifecycleHooks';

const quote = {
  tenant: 'tenant-1',
  quote_id: '11111111-1111-4111-8111-111111111111',
  quote_number: 'Q-0042',
  opportunity_id: '22222222-2222-4222-8222-222222222222',
} as IQuote;

describe('assessment evidence quote hook', () => {
  it('records idempotent quote-referenced Assessment evidence when a selected service is mapped', async () => {
    const record = vi.fn().mockResolvedValue({});
    const recorded = await recordAssessmentEvidenceForAcceptedQuote(
      {} as any,
      quote,
      'tenant-1',
      quote.opportunity_id!,
      {
        loadAssessmentServiceIds: vi.fn().mockResolvedValue(['assessment-service']),
        loadSelectedQuoteItems: vi.fn().mockResolvedValue([
          { service_id: 'managed-service', is_selected: true },
          { service_id: 'assessment-service', is_selected: true },
        ]),
        record,
      },
    );

    expect(recorded).toBe(true);
    expect(record).toHaveBeenCalledWith(expect.anything(), 'tenant-1', {
      opportunityId: quote.opportunity_id,
      checkpoint: 'assessment',
      source: 'system',
      refType: 'quote',
      refId: quote.quote_id,
      detail: 'Assessment service accepted on quote Q-0042',
    });
  });

  it('does not record Assessment evidence when no selected item matches', async () => {
    const record = vi.fn();
    expect(await recordAssessmentEvidenceForAcceptedQuote(
      {} as any,
      quote,
      'tenant-1',
      quote.opportunity_id!,
      {
        loadAssessmentServiceIds: vi.fn().mockResolvedValue(['assessment-service']),
        loadSelectedQuoteItems: vi.fn().mockResolvedValue([
          { service_id: 'managed-service', is_selected: true },
        ]),
        record,
      },
    )).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
});
