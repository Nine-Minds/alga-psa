import { describe, expect, it } from 'vitest';
import { mapRenewalCandidates } from '../src/lib/generators/renewalGenerator';
import {
  buildTmConversionSuggestions,
  trailingTwelveMonthKeys,
} from '../src/lib/generators/tmConversionGenerator';
import { assembleWhitespaceGrid } from '../src/lib/generators/whitespaceGenerator';

describe('opportunity generator facts', () => {
  it('maps a seeded renewal candidate to the existing monthly-value rollup and renewal work item', () => {
    const suggestions = mapRenewalCandidates([{
      client_contract_id: 'assignment-1',
      client_id: 'client-1',
      contract_name: 'Managed Services',
      currency_code: 'USD',
      end_date: '2026-09-10',
      decision_due_date: '2026-08-11',
      renewal_cycle_key: 'fixed-term:2026-09-10',
    }], new Map([['assignment-1', {
      clientContractId: 'assignment-1',
      monthlyValueCents: 245000,
      currencyCode: 'USD',
    }]]), new Date('2026-07-12T00:00:00.000Z'));

    expect(suggestions).toEqual([expect.objectContaining({
      title: 'Managed Services renewal',
      mrr_cents: 245000,
      currency_code: 'USD',
      dedupe_key: 'renewal:assignment-1:fixed-term:2026-09-10',
      evidence: expect.objectContaining({
        end_date: '2026-09-10',
        days_to_renewal: 60,
        monthly_value_cents: 245000,
        renewal_work_item_id: 'assignment-1',
      }),
    })]);
  });

  it('fires a quarterly T&M conversion at the configured monthly-average threshold', () => {
    const months = trailingTwelveMonthKeys(new Date('2026-07-12T00:00:00.000Z'));
    const monthlyTotals = months.map((month, index) => ({
      month,
      total_cents: index === 0 ? 240000 : 120000,
    }));
    const total = monthlyTotals.reduce((sum, bucket) => sum + bucket.total_cents, 0);
    const suggestions = buildTmConversionSuggestions([{
      client_id: 'client-1',
      client_name: 'Acme',
      currency_code: 'USD',
      monthly_totals: monthlyTotals,
      trailing_12_total_cents: total,
      monthly_avg_cents: Math.round(total / 12),
    }], 120000, '2026-3');

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      client_id: 'client-1',
      mrr_cents: 130000,
      dedupe_key: 'tm:client-1:2026-3',
      evidence: {
        monthly_totals: expect.any(Array),
        trailing_12_total_cents: 1560000,
        monthly_avg_cents: 130000,
        client_count: 1,
        client_names: ['Acme'],
      },
    });
  });

  it('marks a category comparable at 50 percent adoption across active-contract clients', () => {
    const grid = assembleWhitespaceGrid([
      { client_id: 'client-1', client_name: 'Acme', default_currency_code: 'USD' },
      { client_id: 'client-2', client_name: 'Beta', default_currency_code: 'USD' },
    ], [{ category_id: 'security', category_name: 'Security' }], [
      { client_id: 'client-1', category_id: 'security' },
    ]);

    expect(grid.categories[0]).toMatchObject({
      adopted_client_count: 1,
      adoption_percentage: 50,
      is_comparable: true,
    });
    expect(grid.clients[1].cells[0]).toEqual({ category_id: 'security', has_category: false });
  });
});
