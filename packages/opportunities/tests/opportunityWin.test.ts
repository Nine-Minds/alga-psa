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
        getOpportunityForProject: vi.fn(),
        getLinkedQuote: vi.fn().mockResolvedValue({
          quote_id: '22222222-2222-4222-8222-222222222222',
          status: 'accepted',
        }),
        convertQuoteToDraftContract: convert,
        createProjectFromTemplate: vi.fn(),
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
        getOpportunityForProject: vi.fn(),
        getLinkedQuote: vi.fn().mockResolvedValue({ quote_id: 'quote-1', status: 'sent' }),
        convertQuoteToDraftContract: vi.fn(),
        createProjectFromTemplate: vi.fn(),
      },
    )).rejects.toThrow('Conversion quote must be accepted');
  });

  it('creates a project from the opportunity in the caller transaction', async () => {
    const trx = {} as any;
    const createProject = vi.fn().mockResolvedValue('project-1');

    const result = await prepareOpportunityWinConversions(
      trx,
      'tenant-1',
      'opportunity-1',
      'user-1',
      {
        project_template_id: 'template-1',
        project_name: 'Managed service onboarding',
        project_status_id: 'status-1',
        project_start_date: '2026-07-14',
      },
      {
        getOpportunityForProject: vi.fn().mockResolvedValue({
          title: 'New managed service',
          client_id: 'client-1',
        }),
        getLinkedQuote: vi.fn(),
        convertQuoteToDraftContract: vi.fn(),
        createProjectFromTemplate: createProject,
      },
    );

    expect(createProject).toHaveBeenCalledWith(trx, 'tenant-1', 'template-1', {
      project_name: 'Managed service onboarding',
      client_id: 'client-1',
      status_id: 'status-1',
      start_date: '2026-07-14',
    });
    expect(result).toEqual({ converted_project_id: 'project-1' });
  });
});
