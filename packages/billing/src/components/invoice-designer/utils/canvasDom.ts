/** Marks a rendered block on the canvas so drags, handles and reveals can find it. */
export const DESIGNER_NODE_ID_ATTRIBUTE = 'data-designer-node-id';
/** Marks the page artboard on the canvas. */
export const DESIGNER_CANVAS_SELECTOR = '[data-designer-canvas="true"]';
/** Marks the scrolling viewport the artboard is shown in. */
export const DESIGNER_CANVAS_VIEWPORT_SELECTOR = '[data-designer-canvas-viewport="true"]';

/** Outline rows and their pane, for drags that drop into the tree. */
export const DESIGNER_OUTLINE_PANE_ATTRIBUTE = 'data-designer-outline-pane';
export const DESIGNER_OUTLINE_NODE_ID_ATTRIBUTE = 'data-designer-outline-node-id';
export const DESIGNER_OUTLINE_DEPTH_ATTRIBUTE = 'data-designer-outline-depth';
export const DESIGNER_OUTLINE_EXPANDED_ATTRIBUTE = 'data-designer-outline-expanded';

export const designerNodeSelector = (nodeId: string) =>
  `[${DESIGNER_NODE_ID_ATTRIBUTE}="${nodeId.replace(/["\\]/g, '\\$&')}"]`;

/** Scrolls the canvas just enough to show a block, e.g. after picking it in the Outline. */
export const revealCanvasNode = (nodeId: string, root: ParentNode = document) => {
  const element = root.querySelector<HTMLElement>(designerNodeSelector(nodeId));
  element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
};

/** Canvas padding plus the vertical ruler, in screen px, around the page. */
const CANVAS_CHROME_PX = 2 * 32 + 20;

/** Largest zoom (in 5% steps, 50–100%) at which a page of `pageWidth` fits the viewport. */
export const resolveFitScale = (viewportWidth: number, pageWidth: number): number => {
  if (!(viewportWidth > 0) || !(pageWidth > 0)) return 1;
  const fit = Math.floor(((viewportWidth - CANVAS_CHROME_PX) / pageWidth) * 20) / 20;
  return Math.min(1, Math.max(0.5, fit));
};
