import { describe, expect, it } from 'vitest';
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { resolveSortableStrategy } from './sortableStrategy';

describe('resolveSortableStrategy', () => {
  it('uses rectSortingStrategy for grid containers', () => {
    expect(resolveSortableStrategy({ display: 'grid', gridTemplateColumns: '1fr' } as any)).toBe(rectSortingStrategy);
  });

  it('uses horizontalListSortingStrategy for flex row containers', () => {
    expect(resolveSortableStrategy({ display: 'flex', flexDirection: 'row' } as any)).toBe(horizontalListSortingStrategy);
  });

  it('uses verticalListSortingStrategy for flex column containers and fallbacks', () => {
    expect(resolveSortableStrategy({ display: 'flex', flexDirection: 'column' } as any)).toBe(verticalListSortingStrategy);
    expect(resolveSortableStrategy(undefined)).toBe(verticalListSortingStrategy);
  });
});

