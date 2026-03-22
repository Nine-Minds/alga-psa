import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const usageTrackingSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/components/billing-dashboard/UsageTracking.tsx'),
  'utf8',
);

describe('usage tracking picker decoupling guards', () => {
  it('T017: usage tracking service picker is not gated by catalog billing_method', () => {
    expect(usageTrackingSource).not.toContain(".filter(service => service.billing_method === 'usage')");
    expect(usageTrackingSource).toContain(".filter((service) => service.item_kind !== 'product')");
  });

  it('T017: usage tracking filter and create dialog both use shared service-context options', () => {
    expect(usageTrackingSource).toContain('const usageServiceOptions = useMemo(');
    expect(usageTrackingSource).toContain('...usageServiceOptions');
    expect(usageTrackingSource).toContain('options={usageServiceOptions}');
  });
});
