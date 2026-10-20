import { describe, expect, it } from 'vitest';
import { buildAutomaticDiscountPolicies } from '../../../services/invoiceAutomaticAdjustments';
import { evaluateContractInvoiceAdjustments, type AutomaticDiscountPolicy } from './contractInvoiceAdjustments';

describe('contract discount assignment settlement identity', () => {
  it('keeps one shared definition distinct for each client-contract assignment and isolates its eligible base', () => {
    const policies = buildAutomaticDiscountPolicies([
      { discount_id: 'shared-definition', source_identity: 'assignment-a', assignment_scope: 'contract', assignment_client_contract_id: 'client-contract-a', discount_name: 'Default', discount_type: 'percentage', value: 0.1, scope: 'invoice' },
      { discount_id: 'shared-definition', source_identity: 'assignment-b', assignment_scope: 'contract', assignment_client_contract_id: 'client-contract-b', discount_name: 'Default', discount_type: 'percentage', value: 0.1, scope: 'invoice' },
    ]);

    const result = evaluateContractInvoiceAdjustments({
      charges: [
        { item_id: 'a-1', client_contract_id: 'client-contract-a', description: 'line one', quantity: 1, unit_price: 10000, net_amount: 10000 },
        { item_id: 'a-2', client_contract_id: 'client-contract-a', description: 'line two', quantity: 1, unit_price: 5000, net_amount: 5000 },
        { item_id: 'b-1', client_contract_id: 'client-contract-b', description: 'other contract', quantity: 1, unit_price: 20000, net_amount: 20000 },
        { item_id: 'manual-unattributed', client_contract_id: null, description: 'manual', quantity: 1, unit_price: 1000, net_amount: 1000, is_manual: true },
      ],
      automaticDiscounts: policies,
    });

    expect(policies.map((policy) => policy.discount_id)).toEqual(['assignment-a', 'assignment-b']);
    expect(result.discounts.map((discount) => [discount.discount_id, discount.base_amount, discount.amount])).toEqual([
      ['assignment-a', 16000, 1600],
      ['assignment-b', 21000, 2100],
    ]);
    expect(result.discounts[0].allocations).toContainEqual({ discount_id: 'assignment-a', item_id: 'manual-unattributed', amount: 100 });
    expect(result.discounts[0].allocations).not.toContainEqual(expect.objectContaining({ item_id: 'b-1' }));
  });
});

describe('discount source-period eligibility', () => {
  const charges = [
    { item_id: 'jan-trueup', description: 'January true-up', quantity: 1, unit_price: 15484, net_amount: 15484, service_periods: [{ start: '2023-01-01', end: '2023-02-01' }] },
    { item_id: 'feb-base', description: 'February recurring', quantity: 1, unit_price: 420000, net_amount: 420000, service_periods: [{ start: '2023-02-01', end: '2023-03-01' }] },
  ];

  it('limits expired percentage and fixed policies to overlapping source coverage, including disjoint periods', () => {
    const policies: AutomaticDiscountPolicy[] = [
      { discount_id: 'expired-percent', discount_name: 'Jan 10%', discount_type: 'percentage', value: 0.1, scope: 'invoice', effective_period: { start: '2023-01-01', end: '2023-02-01' } },
      { discount_id: 'expired-fixed', discount_name: 'Jan fixed', discount_type: 'fixed', value: 10000, scope: 'invoice', priority: 1, effective_period: { start: '2023-01-10', end: '2023-01-20' } },
    ];
    const result = evaluateContractInvoiceAdjustments({ charges, automaticDiscounts: policies });
    // Only the carried Jan true-up remains on this invoice. The expired policies
    // exclude the unrelated Feb charge and fixed-then-percent stacking is capped
    // against the true-up's remaining source amount.
    expect(result.discounts.map(({ discount_id, base_amount, amount }) => [discount_id, base_amount, amount])).toEqual([
      ['expired-fixed', 15484, 10000],
      ['expired-percent', 15484, 1548],
    ]);
    expect(result.discounts.flatMap((discount) => discount.allocations).some((allocation) => allocation.item_id === 'feb-base')).toBe(false);
    expect(evaluateContractInvoiceAdjustments({ charges, automaticDiscounts: policies })).toEqual(result);
  });

  it('does not treat disjoint covered periods as one continuous eligible interval', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [{ item_id: 'jan-mar', description: 'Separated coverage', quantity: 1, unit_price: 10000,
        net_amount: 10000, service_periods: [{ start: '2023-01-01', end: '2023-02-01' }, { start: '2023-03-01', end: '2023-04-01' }] }],
      automaticDiscounts: [{ discount_id: 'feb-policy', discount_name: 'February only', discount_type: 'fixed', value: 5000,
        scope: 'invoice', effective_period: { start: '2023-02-01', end: '2023-03-01' } }],
    });
    expect(result.discounts).toEqual([]);
    expect(result.netAmount).toBe(10000);
  });

  it('retains invoice-wide behavior for unversioned legacy policies without effective dates', () => {
    const [legacy] = buildAutomaticDiscountPolicies([{
      discount_id: 'legacy', discount_name: 'Legacy 10%', discount_type: 'percentage', value: 0.1,
    }]);
    const result = evaluateContractInvoiceAdjustments({ charges, automaticDiscounts: [legacy] });
    expect(result.discounts[0]).toMatchObject({ base_amount: 435484, amount: 43548 });
  });
});


describe('consolidated charge period amounts', () => {
  it('keeps disjoint period capacity separate while returning canonical parent allocations', () => {
    const charge = { item_id: 'parent', description: 'Jan and Feb', quantity: 1, unit_price: 30000, net_amount: 30000,
      period_allocations: [
        { net_amount: 10000, service_periods: [{ start: '2023-01-01', end: '2023-02-01' }] },
        { net_amount: 20000, service_periods: [{ start: '2023-02-01', end: '2023-03-01' }] },
      ] };
    const policy: AutomaticDiscountPolicy = { discount_id: 'jan', discount_name: 'January', discount_type: 'percentage',
      value: 0.1, scope: 'item', applies_to_item_id: 'parent', effective_period: { start: '2023-01-01', end: '2023-02-01' } };
    const result = evaluateContractInvoiceAdjustments({ charges: [charge], automaticDiscounts: [policy] });
    expect(result.discounts[0]).toMatchObject({ base_amount: 10000, amount: 1000,
      allocations: [{ discount_id: 'jan', item_id: 'parent', amount: 1000 }] });
    const stacked = evaluateContractInvoiceAdjustments({ charges: [charge], automaticDiscounts: [
      { ...policy, discount_type: 'fixed', value: 50000, priority: 0 },
      { ...policy, discount_id: 'jan-again', priority: 1 },
      { ...policy, discount_id: 'feb', effective_period: { start: '2023-02-01', end: '2023-03-01' }, priority: 2 },
    ] });
    expect(stacked.discounts.map((row) => [row.discount_id, row.amount])).toEqual([['jan', 10000], ['feb', 2000]]);
    expect(stacked.netAmount).toBe(18000);
    expect(evaluateContractInvoiceAdjustments({ charges: [charge], automaticDiscounts: [policy] })).toEqual(result);
    expect(() => evaluateContractInvoiceAdjustments({ charges: [{ ...charge, net_amount: 30001 }], automaticDiscounts: [policy] }))
      .toThrow('Service-period allocations do not match');
  });
});
