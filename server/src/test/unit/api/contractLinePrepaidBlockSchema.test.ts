import { describe, expect, it } from 'vitest';
import {
  createContractLineSchema,
  updateContractLineSchema,
  contractLineResponseSchema,
  prepaidBlockConfigSchema,
} from '../../../lib/api/schemas/contractLineSchemas';

const baseLine = {
  contract_line_name: 'Block line',
  billing_frequency: 'monthly',
  contract_line_type: 'Hourly',
};

describe('contract line API prepaid_block overlay', () => {
  it('accepts an optional prepaid_block on create and keeps the type enum unchanged', () => {
    expect(createContractLineSchema.safeParse(baseLine).success).toBe(true);
    const withBlock = createContractLineSchema.safeParse({
      ...baseLine,
      prepaid_block: { block_minutes: 2400, block_price: 440000, expiry_months: 12, replenishment_tier: 'auto_issue' },
    });
    expect(withBlock.success).toBe(true);
    expect(createContractLineSchema.safeParse({ ...baseLine, contract_line_type: 'PrepaidBlock' }).success).toBe(false);
  });

  it('accepts null on update (remove) and rejects malformed configs', () => {
    expect(updateContractLineSchema.safeParse({ prepaid_block: null }).success).toBe(true);
    for (const bad of [
      { block_minutes: 0, block_price: 1 },
      { block_minutes: 60, block_price: -1 },
      { block_minutes: 60, block_price: 1.5 },
      { block_minutes: 60, block_price: 1, expiry_months: 121 },
      { block_minutes: 60, block_price: 1, trigger_threshold_percent: 100 },
      { block_minutes: 60, block_price: 1, replenishment_tier: 'manual' },
    ]) {
      expect(prepaidBlockConfigSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('declares prepaid_block and display_kind on the response schema', () => {
    const shape = contractLineResponseSchema.shape as Record<string, unknown>;
    expect(shape.prepaid_block).toBeDefined();
    expect(shape.display_kind).toBeDefined();
  });

  it('accepts a cadence block with rollover and rejects conflicting terms', () => {
    const ok = { block_minutes: 600, block_price: 150000, issue_mode: 'cadence', rollover_periods: 2 };
    expect(prepaidBlockConfigSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, rollover_periods: 13 },
      { ...ok, expiry_months: 6 },
      { ...ok, trigger_threshold_percent: 20 },
      { block_minutes: 600, block_price: 1, issue_mode: 'consumption', rollover_periods: 1 },
      { block_minutes: 600, block_price: 1, rollover_periods: 1 },
    ]) {
      expect(prepaidBlockConfigSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
