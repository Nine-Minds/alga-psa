import type { DesignerNode } from '../state/designerStore';
import { getNodeStyle } from './nodeProps';

/** `value: null` clears the property. */
export type HandleResizePatch = { path: string; value: string | number | null };

/** A dragged size: px, or `'auto'` when the drag rests on the block's content size. */
export type HandleResizeValue = number | 'auto';

const PX_PATTERN = /^\s*(-?\d+(?:\.\d+)?)px\s*$/;

const readPx = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = PX_PATTERN.exec(value);
  return match ? Number.parseFloat(match[1]) : null;
};

const isUnsized = (value: unknown) => value === undefined || value === null || value === '' || value === 'auto';

/**
 * The style writes that make a block `size` px wide/tall after a handle drag.
 *
 * A drag edits the property that actually governs the box, so the block ends up the
 * size the user dragged it to: a content-sized block with a minimum is sized by that
 * minimum, so the minimum changes; otherwise the block gets a fixed size, and a
 * minimum or maximum that would hold it at another size follows the drag.
 * Only the dragged dimension is written; `'auto'` clears the authored size.
 */
export const resolveHandleResizePatch = (
  node: DesignerNode,
  size: { width?: HandleResizeValue; height?: HandleResizeValue }
): HandleResizePatch[] => {
  const style = (getNodeStyle(node) ?? {}) as Record<string, unknown>;
  const patches: HandleResizePatch[] = [];

  const apply = (dimension: 'width' | 'height', value: HandleResizeValue | undefined) => {
    if (value === undefined) return;
    if (value === 'auto') {
      // Back to content size: the authored size goes; a minimum that sizes the block stays.
      if (style[dimension] !== undefined) patches.push({ path: `style.${dimension}`, value: null });
      return;
    }
    if (!Number.isFinite(value)) return;
    const rounded = Math.max(1, Math.round(value));
    const capitalized = dimension === 'width' ? 'Width' : 'Height';
    const minKey = `min${capitalized}`;
    const maxKey = `max${capitalized}`;
    const min = readPx(style[minKey]);
    const max = readPx(style[maxKey]);

    if (isUnsized(style[dimension]) && min !== null) {
      patches.push({ path: `style.${minKey}`, value: `${rounded}px` });
      if (max !== null && max < rounded) patches.push({ path: `style.${maxKey}`, value: `${rounded}px` });
      return;
    }

    patches.push({ path: `style.${dimension}`, value: `${rounded}px` });
    if (min !== null && min > rounded) patches.push({ path: `style.${minKey}`, value: `${rounded}px` });
    if (max !== null && max < rounded) patches.push({ path: `style.${maxKey}`, value: `${rounded}px` });
    // Legacy geometry still feeds size-mode helpers; keep it in step with the authored size.
    patches.push({ path: `size.${dimension}`, value: rounded });
    patches.push({ path: `baseSize.${dimension}`, value: rounded });
  };

  apply('width', size.width);
  apply('height', size.height);
  return patches;
};
