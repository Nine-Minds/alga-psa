import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable';

import type { DesignerContainerLayout } from '../state/designerStore';

export const resolveSortableStrategy = (layout?: DesignerContainerLayout): SortingStrategy => {
  if (layout?.display === 'grid') {
    return rectSortingStrategy;
  }
  if (layout?.display === 'flex' && layout.flexDirection === 'row') {
    return horizontalListSortingStrategy;
  }
  return verticalListSortingStrategy;
};

