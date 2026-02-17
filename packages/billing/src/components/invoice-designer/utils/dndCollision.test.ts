import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    pointerWithin: vi.fn(),
    closestCenter: vi.fn(),
  };
});

import { closestCenter, pointerWithin } from '@dnd-kit/core';
import { invoiceDesignerCollisionDetection } from './dndCollision';

describe('invoiceDesignerCollisionDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers pointerWithin and sorts collisions by smallest droppable rect', () => {
    (pointerWithin as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'a' },
      { id: 'b' },
    ]);
    (closestCenter as unknown as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 'fallback' }]);

    const args = {
      droppableRects: new Map<any, any>([
        ['a', { width: 10, height: 10 }],
        ['b', { width: 5, height: 5 }],
      ]),
    } as any;

    const result = invoiceDesignerCollisionDetection(args);
    expect(result.map((c: any) => c.id)).toEqual(['b', 'a']);
    expect(pointerWithin).toHaveBeenCalledTimes(1);
    expect(closestCenter).not.toHaveBeenCalled();
  });

  it('falls back to closestCenter when pointer is not within any droppable', () => {
    (pointerWithin as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (closestCenter as unknown as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 'c' }]);

    const args = {
      droppableRects: new Map<any, any>(),
    } as any;

    const result = invoiceDesignerCollisionDetection(args);
    expect(result.map((c: any) => c.id)).toEqual(['c']);
    expect(pointerWithin).toHaveBeenCalledTimes(1);
    expect(closestCenter).toHaveBeenCalledTimes(1);
  });
});

