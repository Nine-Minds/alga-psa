import { describe, expect, it, vi } from 'vitest';

const inserted: any[] = [];
let currentMax: number | null = 4;

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => {
      const chain: any = {
        where: () => chain,
        max: () => chain,
        first: async () => ({ max: currentMax }),
        insert: (rows: any[]) => {
          inserted.push(...rows);
          return { returning: async () => rows.map((r, i) => ({ checklist_item_id: `id-${i}`, item_name: r.item_name })) };
        },
      };
      return chain;
    },
  }),
}));

import { addChecklistItemsToTicket } from '../addItems';

describe('addChecklistItemsToTicket', () => {
  it('appends after the current max order_number with source and no template', async () => {
    inserted.length = 0;
    currentMax = 4;
    const out = await addChecklistItemsToTicket({} as any, 't', 'tk', [
      { item_name: ' One ', description: 'd', is_required: true },
      { item_name: 'Two' },
    ], { source: 'workflow', createdBy: 'u' });

    expect(inserted.map((r) => r.order_number)).toEqual([5, 6]);
    expect(inserted[0]).toMatchObject({ item_name: 'One', source: 'workflow', template_id: null, created_by: 'u', is_required: true });
    expect(inserted[1]).toMatchObject({ is_required: false, description: null });
    expect(out).toHaveLength(2);
  });

  it('starts at 0 on an empty checklist and no-ops on no items', async () => {
    inserted.length = 0;
    currentMax = null;
    await addChecklistItemsToTicket({} as any, 't', 'tk', [{ item_name: 'A' }], { source: 'workflow' });
    expect(inserted[0].order_number).toBe(0);
    expect(await addChecklistItemsToTicket({} as any, 't', 'tk', [], { source: 'workflow' })).toEqual([]);
  });
});
