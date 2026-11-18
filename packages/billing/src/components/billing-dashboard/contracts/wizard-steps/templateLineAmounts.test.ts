import { describe, expect, it } from 'vitest';
import {
  effectiveAmount,
  findMissingTemplateAmounts,
  listTemplateAmountFields,
  prefillCatalogEdits,
  withAmountEdit,
} from './templateLineAmounts';

const field = (over: Record<string, unknown> = {}) => ({
  slot_key: 'k',
  template_amount: null,
  amount: null,
  catalog_amount: null,
  required: false,
  ...over,
});

// Mismatch fallback: template is USD, contract is EUR, no price set.
const view: any = {
  template_id: 't1',
  currency_code: 'EUR',
  template_currency: 'USD',
  amount_source: 'none',
  can_save_template_amounts: true,
  lines: [
    {
      template_line_id: 'l1',
      line_name: 'Support',
      line_type: 'Hourly',
      base_rate: field(),
      overtime_rate: field(),
      bucket_pools: [],
      services: [
        {
          service_id: 's1',
          service_name: 'Helpdesk',
          rate: field({ slot_key: 'a', template_amount: 15000, required: true, catalog_amount: 12000 }),
          overtime_rate: field(),
          bucket_overage_rate: field(),
        },
        {
          service_id: 's2',
          service_name: 'Onsite',
          rate: field({ slot_key: 'b', template_amount: 20000, required: true }),
          overtime_rate: field(),
          bucket_overage_rate: field(),
        },
      ],
    },
  ],
};

describe('template line amounts (mismatch fallback)', () => {
  it('lists every field and flags required ones with no value as missing', () => {
    expect(listTemplateAmountFields(view).length).toBeGreaterThan(4);
    const missing = findMissingTemplateAmounts(view, []);
    expect(missing.map((ref) => ref.service?.service_id)).toEqual(['s2']);
  });

  it('prefills only fields that have a catalog price in the contract currency', () => {
    const edits = prefillCatalogEdits(view, []);
    const ref = listTemplateAmountFields(view).find((r) => r.service?.service_id === 's1' && r.kind === 'member_rate')!;
    expect(effectiveAmount(edits, ref)).toBe(12000);
    expect(prefillCatalogEdits(view, edits)).toBe(edits);
  });

  it('an operator entry fills a missing field and clears the block', () => {
    const ref = listTemplateAmountFields(view).find((r) => r.service?.service_id === 's2' && r.kind === 'member_rate')!;
    const edits = withAmountEdit([], ref, 18000);
    expect(findMissingTemplateAmounts(view, edits).map((r) => r.service?.service_id)).toEqual([]);
  });
});
