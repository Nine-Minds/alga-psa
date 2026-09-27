import { describe, expect, it } from 'vitest';
import { buildAutomaticDiscountPolicies } from '../../../services/invoiceAutomaticAdjustments';
import { evaluateContractInvoiceAdjustments } from './contractInvoiceAdjustments';

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
      ['assignment-a', 15000, 1500],
      ['assignment-b', 20000, 2000],
    ]);
  });
});
