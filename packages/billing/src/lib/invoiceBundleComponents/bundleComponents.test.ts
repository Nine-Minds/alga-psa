import { describe, expect, it } from 'vitest';
import { buildBundleSnapshot, type BundleSnapshotDetailInput } from './snapshot';
import { selectPreviousPeriods, isExcludedPreviousPeriodStatus, type PreviousPeriodRow } from './previousPeriod';
import { buildBundleComponents } from './components';

const P1 = { s: '2026-09-01T00:00:00.000Z', e: '2026-10-01T00:00:00.000Z' };
const P2 = { s: '2026-10-01T00:00:00.000Z', e: '2026-11-01T00:00:00.000Z' };

const detail = (id: string, serviceId: string, name: string, q: number | null, basis: 'unit' | 'bundle', created: string, p = P2): BundleSnapshotDetailInput => ({
  detailItemId: id, serviceId, serviceName: name, rawQuantity: q, pricingBasis: basis, configCreatedAt: created,
  servicePeriodStart: p.s, servicePeriodEnd: p.e,
});

const prevRow = (over: Partial<PreviousPeriodRow>): PreviousPeriodRow => ({
  contractLineId: 'L1', serviceId: 'ws', serviceName: 'Workstations', itemDetailId: 'pd1', detailQuantity: 46,
  servicePeriodStart: P1.s, servicePeriodEnd: P1.e, bundlePresentation: null, ...over,
});

describe('selectPreviousPeriods', () => {
  const req = [{ contractLineId: 'L1', earliestPeriodStart: P2.s }];
  it('returns null when the line has no prior period', () => {
    expect(selectPreviousPeriods(req, []).get('L1')).toBeNull();
    // a period that ends after this one starts is not "previous"
    expect(selectPreviousPeriods(req, [prevRow({ servicePeriodStart: P2.s, servicePeriodEnd: P2.e })]).get('L1')).toBeNull();
  });
  it('sums per service and prefers the snapshot quantity over the clamped detail quantity', () => {
    const rows = [
      prevRow({ itemDetailId: 'a', detailQuantity: 1, bundlePresentation: { version: 1, subtitle: null, components: [{ serviceId: 'ws', name: 'Workstations', quantity: 0, pricingBasis: 'bundle', order: 0, servicePeriodStart: P1.s, servicePeriodEnd: P1.e, detailItemIds: ['a'], previousQuantity: null, comparison: 'no_prior_period' }] } }),
      prevRow({ itemDetailId: 'b', serviceId: 'srv', serviceName: 'Servers', detailQuantity: 5 }),
      prevRow({ itemDetailId: 'c', serviceId: 'srv', serviceName: 'Servers', detailQuantity: 1 }),
    ];
    const prev = selectPreviousPeriods(req, rows).get('L1')!;
    expect(prev.quantitiesByServiceId.get('ws')).toBe(0);
    expect(prev.quantitiesByServiceId.get('srv')).toBe(6);
  });
  it('uses only the latest prior period', () => {
    const older = { servicePeriodStart: '2026-08-01T00:00:00.000Z', servicePeriodEnd: P1.s };
    const prev = selectPreviousPeriods(req, [prevRow({ ...older, detailQuantity: 99 }), prevRow({})]).get('L1')!;
    expect(prev.quantitiesByServiceId.get('ws')).toBe(46);
  });
});

describe('buildBundleSnapshot', () => {
  const details = [
    detail('d2', 'srv', 'Servers', 6, 'bundle', '2026-01-02'),
    detail('d1', 'ws', 'Workstations', 48, 'unit', '2026-01-01'),
    detail('d3', 'new', 'SOC', 54, 'bundle', '2026-01-03'),
  ];
  const previousPeriod = {
    quantitiesByServiceId: new Map<string, number | null>([['ws', 46], ['srv', 6], ['gone', 3]]),
    serviceNames: new Map([['ws', 'Workstations'], ['srv', 'Servers'], ['gone', 'Old backup']]),
  };
  it('records no_prior_period on the first invoice', () => {
    const snap = buildBundleSnapshot({ subtitle: ' sub ', details, previousPeriod: null });
    expect(snap.subtitle).toBe('sub');
    expect(snap.components.every((c) => c.comparison === 'no_prior_period' && c.previousQuantity === null)).toBe(true);
    expect(snap.components.map((c) => c.name)).toEqual(['Workstations', 'Servers', 'SOC']);
  });
  it('computes previous quantities, treats new services as 0 and adds removed services at 0', () => {
    const snap = buildBundleSnapshot({ subtitle: null, details, previousPeriod });
    const by = Object.fromEntries(snap.components.map((c) => [c.serviceId, c]));
    expect(by.ws.previousQuantity).toBe(46);
    expect(by.new.previousQuantity).toBe(0);
    expect(by.gone).toMatchObject({ quantity: 0, previousQuantity: 3, detailItemIds: [], name: 'Old backup' });
    const built = buildBundleComponents(snap, { includePricing: false })!;
    expect(built.components.map((c) => [c.name, c.quantity, c.quantityChange])).toEqual([
      ['Workstations', 48, 2], ['Servers', 6, null], ['SOC', 54, 54], ['Old backup', 0, -3],
    ]);
    expect(built.components.some((c) => 'unitPrice' in c || 'total' in c)).toBe(false);
  });
  it('keeps raw unclamped quantities', () => {
    const snap = buildBundleSnapshot({ subtitle: null, details: [detail('x', 'a', 'A', 0, 'bundle', '2026-01-01'), detail('y', 'b', 'B', null, 'bundle', '2026-01-02')], previousPeriod: null });
    expect(snap.components.map((c) => c.quantity)).toEqual([0, null]);
  });
  it('splits per period when quantities differ and compares with the preceding period', () => {
    const snap = buildBundleSnapshot({
      subtitle: null,
      previousPeriod: { quantitiesByServiceId: new Map([['ws', 40], ['srv', 6]]), serviceNames: new Map() },
      details: [
        detail('a1', 'ws', 'Workstations', 42, 'bundle', '2026-01-01', P1),
        detail('a2', 'ws', 'Workstations', 45, 'bundle', '2026-01-01', P2),
        detail('b1', 'srv', 'Servers', 6, 'bundle', '2026-01-02', P1),
        detail('b2', 'srv', 'Servers', 6, 'bundle', '2026-01-02', P2),
      ],
    });
    const built = buildBundleComponents(snap, { includePricing: false })!;
    expect(built.components.filter((c) => c.name === 'Servers')).toHaveLength(1);
    const ws = built.components.filter((c) => c.name === 'Workstations');
    expect(ws.map((c) => [c.quantity, c.quantityChange, c.periodLabelStart])).toEqual([[42, 2, P1.s], [45, 3, P2.s]]);
  });
});

describe('buildBundleComponents pricing', () => {
  it('sets totals from allocated amounts and unit rates only for unit services', () => {
    const snap = buildBundleSnapshot({ subtitle: null, previousPeriod: null, details: [detail('d1', 'ws', 'Workstations', 10, 'unit', '2026-01-01'), detail('d2', 'srv', 'Servers', 2, 'bundle', '2026-01-02')] });
    const built = buildBundleComponents(snap, { includePricing: true, amounts: { d1: { allocated_amount: 5000, rate: 500 }, d2: { allocated_amount: 1234, rate: 617 } } })!;
    expect(built.components[0]).toMatchObject({ total: 5000, unitPrice: 500 });
    expect(built.components[1].total).toBe(1234);
    expect('unitPrice' in built.components[1]).toBe(false);
    expect(built.components.reduce((s, c) => s + (c.total ?? 0), 0)).toBe(6234);
  });
  it('returns null without a snapshot', () => {
    expect(buildBundleComponents(null, { includePricing: false })).toBeNull();
  });
});

describe('previous-period invoice status exclusion', () => {
  const req = [{ contractLineId: 'L1', earliestPeriodStart: P2.s }];
  it.each(['cancelled', 'Cancelled', 'CANCELLED', 'canceled', 'Canceled', 'void', 'Void', ' VOID '])(
    'ignores a prior invoice with status %s',
    (status) => {
      expect(isExcludedPreviousPeriodStatus(status)).toBe(true);
      expect(selectPreviousPeriods(req, [prevRow({ invoiceStatus: status })]).get('L1')).toBeNull();
    },
  );
  it.each(['draft', 'Draft', 'sent', 'paid', 'finalized', null, undefined])('counts a prior invoice with status %s', (status) => {
    expect(isExcludedPreviousPeriodStatus(status as any)).toBe(false);
    expect(selectPreviousPeriods(req, [prevRow({ invoiceStatus: status as any })]).get('L1')).not.toBeNull();
  });
  it('falls back to the next-latest valid period when the latest is void', () => {
    const older = prevRow({ itemDetailId: 'o', detailQuantity: 40, servicePeriodStart: '2026-08-01T00:00:00.000Z', servicePeriodEnd: P1.s });
    const voided = prevRow({ invoiceStatus: 'void' });
    expect(selectPreviousPeriods(req, [older, voided]).get('L1')?.quantitiesByServiceId.get('ws')).toBe(40);
  });
});
