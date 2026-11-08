/**
 * Pure unit tests for the wizard-draft discount hydrator
 * (ee/server/src/lib/billing/simulator/draftContractToScenario.ts). No database
 * access: the mapping under test only converts authoring units into the
 * scenario model the shared compute layer prices.
 */

import { describe, expect, it } from 'vitest';
import type { ContractDraftDiscount } from '@alga-psa/types';
import { draftDiscountsToScenario } from '@ee/lib/billing/simulator/draftContractToScenario';

const discount = (overrides: Partial<ContractDraftDiscount> = {}): ContractDraftDiscount => ({
  draft_key: 'draft-key-1',
  discount_name: 'Loyalty',
  discount_type: 'percentage',
  value: 10,
  start_date: '2026-09-01',
  end_date: null,
  ...overrides,
});

describe('draftDiscountsToScenario', () => {
  it('converts a percentage discount to the evaluator fraction and a contract-wide scope', () => {
    expect(draftDiscountsToScenario([discount()])).toEqual([
      {
        discount_id: 'draft-key-1',
        discount_name: 'Loyalty',
        discount_type: 'percentage',
        value: 0.1,
        start_date: '2026-09-01T00:00:00Z',
        end_date: null,
        // Empty keys are the contract-wide settlement: every eligible charge.
        contract_line_keys: [],
      },
    ]);
  });

  it('converts a fixed discount to integer minor units and keeps its end date', () => {
    const [scenarioDiscount] = draftDiscountsToScenario([
      discount({ discount_type: 'fixed', value: 50.5, end_date: '2026-12-31' }),
    ]);

    expect(scenarioDiscount.value).toBe(5050);
    expect(scenarioDiscount.end_date).toBe('2026-12-31T00:00:00Z');
  });

  it('drops half-authored drafts rather than simulating a discount the server would refuse', () => {
    expect(
      draftDiscountsToScenario([
        discount({ draft_key: 'a', discount_name: '   ' }),
        discount({ draft_key: 'b', value: Number.NaN }),
        discount({ draft_key: 'c', value: 0 }),
        discount({ draft_key: 'd', start_date: '' }),
      ]),
    ).toEqual([]);
  });

  it('ignores an unparseable end date instead of failing the whole simulation', () => {
    const [scenarioDiscount] = draftDiscountsToScenario([
      discount({ end_date: 'whenever' }),
    ]);

    expect(scenarioDiscount.end_date).toBeNull();
  });

  it('names an unkeyed draft deterministically by position', () => {
    const mapped = draftDiscountsToScenario([
      discount({ draft_key: '' }),
      discount({ draft_key: '', discount_name: 'Second' }),
    ]);

    expect(mapped.map((entry) => entry.discount_id)).toEqual([
      'draft-discount-1',
      'draft-discount-2',
    ]);
  });

  it('simulates nothing when the wizard authored no discounts', () => {
    expect(draftDiscountsToScenario(undefined)).toEqual([]);
    expect(draftDiscountsToScenario([])).toEqual([]);
  });
});
