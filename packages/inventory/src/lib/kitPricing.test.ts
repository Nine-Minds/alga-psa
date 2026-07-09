import { describe, expect, it, vi } from 'vitest';
import { calculateKitFinancials, resolveKitPricePolicy } from '../actions/kitActions';

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn() }));

describe('kit pricing policy', () => {
  it('calculates sum price only from component selling prices and quantities', () => {
    expect(resolveKitPricePolicy('sum', null, [
      { default_rate: 1250, quantity: 2 },
      { default_rate: 300, quantity: 3 },
    ])).toBe(3400);
  });

  it('suppresses margin when a component cost is missing or uses another currency', () => {
    expect(calculateKitFinancials(50000, 'USD', [
      { extended_cost: 350, cost_currency: 'USD' },
      { extended_cost: null, cost_currency: 'USD' },
    ])).toEqual({ componentCost: null, marginAmount: null, marginPercent: null });

    expect(calculateKitFinancials(50000, 'USD', [
      { extended_cost: 350, cost_currency: 'EUR' },
    ])).toEqual({ componentCost: null, marginAmount: null, marginPercent: null });
  });

  it('reports component cost, gross profit, and gross margin when costs are complete', () => {
    expect(calculateKitFinancials(50000, 'USD', [
      { extended_cost: 350, cost_currency: 'USD' },
    ])).toEqual({ componentCost: 350, marginAmount: 49650, marginPercent: 0.993 });
  });
});
