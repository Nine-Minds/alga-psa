import { describe, expect, it, vi } from 'vitest';
import { prepareOpportunityWinConversions } from '../src/lib/opportunityWin';

describe('opportunity win conversions', () => {
  it('converts an accepted linked quote and returns the contract reference for close-won', async () => {
    const convert = vi.fn().mockResolvedValue({
      contract: { contract_id: '33333333-3333-4333-8333-333333333333' },
    });
    const result = await prepareOpportunityWinConversions(
      {} as any,
      'tenant-1',
      '11111111-1111-4111-8111-111111111111',
      'user-1',
      { convert_quote_id: '22222222-2222-4222-8222-222222222222' },
      {
        getLinkedQuote: vi.fn().mockResolvedValue({
          quote_id: '22222222-2222-4222-8222-222222222222',
          status: 'accepted',
        }),
        convertQuoteToDraftContract: convert,
      },
    );

    expect(convert).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      '22222222-2222-4222-8222-222222222222',
      'user-1',
    );
    expect(result).toEqual({
      converted_contract_id: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('rejects a quote that is not both linked and accepted', async () => {
    await expect(prepareOpportunityWinConversions(
      {} as any,
      'tenant-1',
      'opportunity-1',
      'user-1',
      { convert_quote_id: 'quote-1' },
      {
        getLinkedQuote: vi.fn().mockResolvedValue({ quote_id: 'quote-1', status: 'sent' }),
        convertQuoteToDraftContract: vi.fn(),
      },
    )).rejects.toThrow('Conversion quote must be accepted');
  });
});
