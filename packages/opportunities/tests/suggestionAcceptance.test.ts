import { describe, expect, it } from 'vitest';
import { buildAcceptedOpportunity } from '../src/lib/suggestions';

describe('accept suggestion prefill', () => {
  it('creates the generator-typed opportunity with values, provenance, and a seven-day action', () => {
    const accepted = buildAcceptedOpportunity({
      suggestion_id: 'suggestion-1',
      client_id: 'client-1',
      title: 'Managed Services renewal',
      generator_key: 'renewal',
      evidence: { contract_name: 'Managed Services', days_to_renewal: 60 },
      mrr_cents: 245000,
      nrr_cents: 0,
      currency_code: 'USD',
    }, {
      opportunityNumber: 'OPP-1042',
      actorId: 'user-1',
      accountManagerId: 'manager-1',
      now: new Date('2026-07-12T12:00:00.000Z'),
    });

    expect(accepted).toMatchObject({
      opportunity_number: 'OPP-1042',
      client_id: 'client-1',
      opportunity_type: 'renewal',
      owner_id: 'manager-1',
      mrr_cents: 245000,
      generator_key: 'renewal',
      generator_context: { contract_name: 'Managed Services', days_to_renewal: 60 },
      suggestion_id: 'suggestion-1',
      next_action: 'Start the renewal conversation',
      next_action_due: '2026-07-19T12:00:00.000Z',
    });
  });

  it('honors UI overrides without changing generator provenance or opportunity type', () => {
    const accepted = buildAcceptedOpportunity({
      suggestion_id: 'suggestion-2',
      client_id: 'client-2',
      title: 'Acme asset refresh',
      generator_key: 'asset_aging',
      evidence: { count: 3 },
      mrr_cents: 0,
      nrr_cents: 0,
      currency_code: 'USD',
    }, {
      opportunityNumber: 'OPP-1043',
      actorId: 'user-1',
      now: new Date('2026-07-12T12:00:00.000Z'),
      overrides: {
        title: 'Acme workstation refresh',
        next_action: 'Book a discovery call',
        next_action_due: '2026-07-14T15:00:00.000Z',
      },
    });

    expect(accepted).toMatchObject({
      title: 'Acme workstation refresh',
      opportunity_type: 'project',
      generator_key: 'asset_aging',
      next_action: 'Book a discovery call',
      next_action_due: '2026-07-14T15:00:00.000Z',
    });
  });
});
