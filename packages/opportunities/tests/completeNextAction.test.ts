import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOpportunity } from '@alga-psa/types';

const dbMocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: dbMocks.tenantDb,
}));

import { completeOpportunityNextAction } from '../src/lib/completedActionInteraction';
import { OpportunityModel } from '../src/models/opportunityModel';

const currentOpportunity = {
  tenant: 'tenant-1',
  opportunity_id: 'opportunity-1',
  opportunity_number: 'OPP-0001',
  client_id: 'client-1',
  contact_id: 'contact-1',
  title: 'Expansion',
  opportunity_type: 'expansion',
  owner_id: 'user-1',
  status: 'open',
  stage: 'identified',
  confidence: 'medium',
  mrr_cents: 0,
  nrr_cents: 0,
  hardware_cents: 0,
  currency_code: 'USD',
  values_locked_by_quote: false,
  next_action: 'Call Dana about the assessment',
  next_action_due: '2026-07-12T15:00:00.000Z',
  last_activity_at: '2026-07-10T15:00:00.000Z',
  created_by: 'user-1',
  created_at: '2026-07-01T15:00:00.000Z',
  updated_at: '2026-07-10T15:00:00.000Z',
} satisfies IOpportunity;

describe('completeOpportunityNextAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    const systemTypeQuery: any = {
      where: vi.fn(),
      select: vi.fn(),
      first: vi.fn().mockResolvedValue({ type_id: 'note-type' }),
    };
    systemTypeQuery.where.mockReturnValue(systemTypeQuery);
    systemTypeQuery.select.mockReturnValue(systemTypeQuery);

    dbMocks.tenantDb.mockReturnValue({
      table: vi.fn((tableName: string) => tableName === 'system_interaction_types'
        ? systemTypeQuery
        : { insert: dbMocks.insert }),
    });
  });

  it('records the completed action on the opportunity timeline before installing the replacement', async () => {
    vi.spyOn(OpportunityModel, 'getById').mockResolvedValue(currentOpportunity);
    vi.spyOn(OpportunityModel, 'update').mockImplementation(async (_trx, _tenant, _id, patch) => ({
      ...currentOpportunity,
      ...patch,
    }));

    const result = await completeOpportunityNextAction(
      {} as any,
      'tenant-1',
      'opportunity-1',
      {
        next_action: 'Send assessment proposal',
        next_action_due: '2026-07-14T15:00:00.000Z',
      },
      'user-1',
    );

    expect(dbMocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-1',
      type_id: 'note-type',
      client_id: 'client-1',
      contact_name_id: 'contact-1',
      opportunity_id: 'opportunity-1',
      user_id: 'user-1',
      title: 'Completed next action: Call Dana about the assessment',
      notes: 'Call Dana about the assessment',
    }));
    expect(OpportunityModel.update).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'opportunity-1',
      expect.objectContaining({
        next_action: 'Send assessment proposal',
        next_action_due: '2026-07-14T15:00:00.000Z',
      }),
    );
    expect(result.next_action).toBe('Send assessment proposal');
  });

  it('rejects completion when there is no current action to preserve', async () => {
    vi.spyOn(OpportunityModel, 'getById').mockResolvedValue({ ...currentOpportunity, next_action: null });
    const update = vi.spyOn(OpportunityModel, 'update');

    await expect(completeOpportunityNextAction(
      {} as any,
      'tenant-1',
      'opportunity-1',
      { next_action: 'Replacement', next_action_due: '2026-07-14T15:00:00.000Z' },
      'user-1',
    )).rejects.toThrow('Opportunity has no current next action to complete');

    expect(dbMocks.insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
