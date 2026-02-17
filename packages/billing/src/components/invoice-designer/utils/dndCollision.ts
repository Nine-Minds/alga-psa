import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type Collision,
} from '@dnd-kit/core';

const resolveArea = (rect: { width: number; height: number } | undefined): number => {
  if (!rect) return Number.POSITIVE_INFINITY;
  return rect.width * rect.height;
};

/**
 * Invoice designer collision detection:
 * - Prefer `pointerWithin` for nested droppables.
 * - Sort pointer collisions by smallest droppable rect as a proxy for "deepest" nesting.
 * - Fall back to `closestCenter` when pointer isn't within any droppable.
 */
export const invoiceDesignerCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return [...pointerCollisions].sort((a: Collision, b: Collision) => {
      const rectA = args.droppableRects.get(a.id);
      const rectB = args.droppableRects.get(b.id);
      return resolveArea(rectA) - resolveArea(rectB);
    });
  }

  return closestCenter(args);
};

