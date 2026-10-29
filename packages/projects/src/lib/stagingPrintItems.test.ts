import { describe, expect, it } from 'vitest';
import { MAX_LABELS_PER_REQUEST } from '@alga-psa/types';
import { planStagingPrint, type PrintableBox, type PrintableLine } from './stagingPrintItems';

const unit = (n: number) => ({ staging_line_id: `l-u${n}`, kind: 'stock' as const, unit_id: `u${n}`, asset_id: null });
const asset = (n: number) => ({ staging_line_id: `l-a${n}`, kind: 'client_asset' as const, unit_id: null, asset_id: `a${n}` });
const qty = (n: number) => ({ staging_line_id: `l-q${n}`, kind: 'stock' as const, unit_id: null, asset_id: null });
const item = (n: number) => ({ staging_line_id: `l-i${n}`, kind: 'client_item' as const, unit_id: null, asset_id: null });

const boxes: PrintableBox[] = [
  { container_id: 'b2', sequence: 2, members: [asset(1), qty(1)] },
  { container_id: 'b1', sequence: 1, members: [unit(1), item(1), unit(2)] },
];
const lines: PrintableLine[] = [
  { ...unit(3), status: 'staged', container_ids: [] },
  { ...unit(4), status: 'reserved', container_ids: [] },
  { ...asset(2), status: 'staged', container_ids: [] },
  { ...unit(1), status: 'staged', container_ids: ['b1'] },
];

describe('planStagingPrint (C6 bulk print order)', () => {
  it('box label, then its unit and asset labels, box by box; unboxed staged items last; quantity lines get none', () => {
    const plan = planStagingPrint(boxes, lines, { canReadInventory: true });
    expect(plan.labels).toEqual([
      { labelClass: 'staging-container', recordId: 'b1' },
      { labelClass: 'stock-unit-identity', recordId: 'u1' },
      { labelClass: 'stock-unit-identity', recordId: 'u2' },
      { labelClass: 'staging-container', recordId: 'b2' },
      { labelClass: 'asset-identity', recordId: 'a1' },
      { labelClass: 'stock-unit-identity', recordId: 'u3' },
      { labelClass: 'asset-identity', recordId: 'a2' },
    ]);
    expect(plan).toMatchObject({ droppedUnitLabels: 0, overCap: false });
  });

  it('leaves unit labels out, and counts them, without inventory:read', () => {
    const plan = planStagingPrint(boxes, lines, { canReadInventory: false });
    expect(plan.labels.some((i) => i.labelClass === 'stock-unit-identity')).toBe(false);
    expect(plan.droppedUnitLabels).toBe(3);
  });

  it('prints only the chosen boxes, and flags plans over the request cap', () => {
    expect(planStagingPrint(boxes, lines, { canReadInventory: true, boxIds: ['b2'], includeUnboxed: false }).labels).toEqual([
      { labelClass: 'staging-container', recordId: 'b2' },
      { labelClass: 'asset-identity', recordId: 'a1' },
    ]);
    const big: PrintableBox[] = [{ container_id: 'big', sequence: 1, members: Array.from({ length: MAX_LABELS_PER_REQUEST }, (_, i) => unit(100 + i)) }];
    expect(planStagingPrint(big, [], { canReadInventory: true }).overCap).toBe(true);
  });
});
