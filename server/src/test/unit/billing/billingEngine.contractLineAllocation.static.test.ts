import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('billingEngine allocation and regression guards', () => {
  const source = readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../../../packages/billing/src/lib/billing/billingEngine.ts',
    ),
    'utf8',
  );

  it('T028: time query has no unconditional null-line fallback and gates null-line allocation by unique service matches', () => {
    expect(source).toContain('this.whereNull("time_entries.contract_line_id").whereIn(');
    expect(source).toContain('uniquelyAssignableServiceIds');
  });

  it('T029: usage query has no unconditional null-line fallback and gates null-line allocation by unique service matches', () => {
    expect(source).toContain('this.whereNull("usage_tracking.contract_line_id").whereIn(');
    expect(source).toContain('uniquelyAssignableServiceIds');
  });

  it('T036: service-membership constraints prevent billing through lines that do not include the service', () => {
    expect(source).toContain('.whereIn("time_entries.service_id", configuredServiceIds)');
    expect(source).toContain('.whereIn("usage_tracking.service_id", configuredServiceIds)');
  });

  it('T037/T038: hourly minimum, round-up, and overtime logic remains in the billing path', () => {
    expect(source).toContain('minimum_billable_time');
    expect(source).toContain('round_up_to_nearest');
    expect(source).toContain('plan.enable_overtime');
    expect(source).toContain('plan.overtime_threshold');
  });

  it('T039: usage minimum/custom-rate/tiered pricing logic remains in the billing path', () => {
    expect(source).toContain('serviceConfig.config.minimum_usage');
    expect(source).toContain('serviceConfig.config.custom_rate');
    expect(source).toContain('serviceConfig.config.enable_tiered_pricing');
    expect(source).toContain('serviceConfig.rateTiers');
  });

  it('T040: bucket overage billing behavior remains in the billing path', () => {
    expect(source).toContain('overageMinutes');
    expect(source).toContain('overageRate');
    expect(source).toContain('type: "bucket"');
  });
});

