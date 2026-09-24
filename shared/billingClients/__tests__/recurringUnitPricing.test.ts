import { describe, expect, it } from 'vitest';
import {
  isRecurringUnitCapable,
  normalizeRecurringBoundary,
  resolveRecurringUnitBaseline,
  resolveRecurringUnitKind,
  selectEffectiveRecurringUnitPricing,
  selectLatestApplicableRevision,
  toRecurringUnitRevisionCandidate,
} from '../recurringUnitPricing';

describe('resolveRecurringUnitKind', () => {
  it('classifies unit-priced Fixed services and catalog products only', () => {
    expect(
      resolveRecurringUnitKind({ configurationType: 'Fixed', pricingBasis: 'unit' }),
    ).toBe('service');
    expect(
      resolveRecurringUnitKind({ configurationType: 'Fixed', itemKind: 'product' }),
    ).toBe('product');
    expect(
      resolveRecurringUnitKind({ configurationType: 'Fixed', pricingBasis: 'bundle' }),
    ).toBeNull();
    expect(
      resolveRecurringUnitKind({ configurationType: 'Usage', itemKind: 'product' }),
    ).toBeNull();
    expect(isRecurringUnitCapable({ configurationType: 'Hourly' })).toBe(false);
  });
});

describe('resolveRecurringUnitBaseline', () => {
  it('never uses the wizard placeholder base_rate as a product override', () => {
    const baseline = resolveRecurringUnitBaseline({
      kind: 'product',
      quantity: 20,
      configurationCustomRate: null,
      serviceLineCustomRate: null,
      fixedBaseRate: 0,
    });
    expect(baseline.quantity).toBe(20);
    expect(baseline.unitRateCents).toBeNull();
    expect(baseline.hasOverride).toBe(false);
  });

  it('keeps product precedence configuration override, then legacy service-line override', () => {
    expect(
      resolveRecurringUnitBaseline({
        kind: 'product',
        quantity: 3,
        configurationCustomRate: 4500,
        serviceLineCustomRate: 4200,
      }).unitRateCents,
    ).toBe(4500);
    expect(
      resolveRecurringUnitBaseline({
        kind: 'product',
        quantity: 3,
        serviceLineCustomRate: 4200,
      }).unitRateCents,
    ).toBe(4200);
  });

  it('lets an explicitly unit-priced service read fixed base_rate first', () => {
    const baseline = resolveRecurringUnitBaseline({
      kind: 'service',
      quantity: 2,
      configurationCustomRate: 5000,
      fixedBaseRate: 7000,
    });
    expect(baseline.unitRateCents).toBe(7000);
  });
});

describe('revision selection', () => {
  const revision = (
    id: string,
    effectivePeriodStart: string,
    overrides: Partial<ReturnType<typeof toRecurringUnitRevisionCandidate>> = {},
  ) => ({
    revisionId: id,
    quantity: 20,
    unitRateCents: 10000,
    pricePolicy: 'override' as const,
    version: 1,
    effectivePeriodStart,
    ...overrides,
  });

  it('picks the latest revision at or before the covered period start', () => {
    const selected = selectLatestApplicableRevision(
      [
        revision('r1', '2026-01-01', { quantity: 20 }),
        revision('r2', '2026-09-01', { quantity: 23 }),
        revision('r3', '2026-10-01', { quantity: 30 }),
      ],
      '2026-09-15',
    );
    expect(selected?.revisionId).toBe('r2');
  });

  it('prefers the higher version at the same boundary, then the newer row', () => {
    const selected = selectLatestApplicableRevision(
      [
        revision('r1', '2026-09-01', { version: 1, quantity: 23 }),
        revision('r2', '2026-09-01', { version: 2, quantity: 25 }),
      ],
      '2026-09-01',
    );
    expect(selected?.revisionId).toBe('r2');
  });

  it('normalizes calendar boundaries without timestamp drift', () => {
    expect(normalizeRecurringBoundary(new Date('2026-09-01T23:00:00-04:00'))).toBe('2026-09-02');
    expect(normalizeRecurringBoundary('2026-09-01')).toBe('2026-09-01');
  });

  it('keeps the baseline before the first revision and the revision from it onward', () => {
    const baseline = { quantity: 20, unitRateCents: 10000 };
    const revisions = [revision('r2', '2026-09-01', { quantity: 23 })];

    const before = selectEffectiveRecurringUnitPricing({
      boundary: '2026-08-01',
      baseline,
      revisions,
    });
    expect(before).toMatchObject({ quantity: 20, source: 'baseline', revisionId: null });

    const after = selectEffectiveRecurringUnitPricing({
      boundary: '2026-09-01',
      baseline,
      revisions,
    });
    expect(after).toMatchObject({
      quantity: 23,
      unitRateCents: 10000,
      pricePolicy: 'override',
      source: 'revision',
      revisionId: 'r2',
    });
  });

  it('carries an explicit zero quantity and a catalog policy through selection', () => {
    const baseline = { quantity: 2, unitRateCents: 20000 };
    const stop = selectEffectiveRecurringUnitPricing({
      boundary: '2026-10-01',
      baseline,
      revisions: [revision('stop', '2026-10-01', { quantity: 0 })],
    });
    expect(stop).toMatchObject({ quantity: 0, source: 'revision' });

    const inherited = selectEffectiveRecurringUnitPricing({
      boundary: '2026-11-01',
      baseline,
      revisions: [revision('resume', '2026-11-01', { quantity: 2, pricePolicy: 'catalog', unitRateCents: null })],
    });
    expect(inherited).toMatchObject({ quantity: 2, pricePolicy: 'catalog', unitRateCents: null });
  });

  it('maps a legacy numeric row to an explicit override candidate', () => {
    const candidate = toRecurringUnitRevisionCandidate({
      revision_id: 'legacy',
      quantity: '4',
      unit_rate_cents: '900',
      effective_period_start: '2026-07-01',
    });
    expect(candidate).toMatchObject({
      revisionId: 'legacy',
      quantity: 4,
      unitRateCents: 900,
      pricePolicy: 'override',
      version: 1,
    });
  });
});
