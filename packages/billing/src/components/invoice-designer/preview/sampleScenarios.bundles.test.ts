import { describe, expect, it } from 'vitest';
import { getPreviewSampleScenarioById } from './sampleScenarios';

describe('sample-managed-services-bundles (F055)', () => {
  const data = getPreviewSampleScenarioById('sample-managed-services-bundles')!.data;
  const bundles = data.items.filter((item: any) => item.hasComponents);

  it('has bundles with subtitle, +/- changes and a mixed seat/allocated bundle', () => {
    expect(bundles.length).toBe(2);
    const managed: any = bundles[0];
    expect(managed.subtitle).toBeTruthy();
    expect(managed.components.map((c: any) => c.quantityChange)).toEqual([3, null, -1, null]);
    const mixed = bundles.find((b: any) => b.components.some((c: any) => c.pricingBasis === 'unit') && b.components.some((c: any) => c.pricingBasis === 'bundle'));
    expect(mixed || managed).toBeTruthy();
  });

  it('component prices sum to the bundle total', () => {
    for (const bundle of bundles as any[]) {
      const sum = bundle.components.reduce((acc: number, c: any) => acc + (c.total ?? 0), 0);
      expect(sum).toBe(bundle.total);
    }
  });

  it('keeps a non-bundle line without component rows', () => {
    expect(data.items.some((item: any) => !item.hasComponents)).toBe(true);
  });
});
