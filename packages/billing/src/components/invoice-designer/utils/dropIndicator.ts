export type DropAxis = 'x' | 'y';

type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Discrete insertion resolution for flex layouts:
 * - Compare active center to hovered (over) center along the container's main axis.
 * - Map to "before" or "after" insertion position (midpoint rule).
 */
export const resolveInsertPositionFromRects = (
  activeRect: RectLike,
  overRect: RectLike,
  axis: DropAxis
): 'before' | 'after' => {
  const activeCenter = axis === 'x' ? activeRect.left + activeRect.width / 2 : activeRect.top + activeRect.height / 2;
  const overCenter = axis === 'x' ? overRect.left + overRect.width / 2 : overRect.top + overRect.height / 2;
  return activeCenter < overCenter ? 'before' : 'after';
};

