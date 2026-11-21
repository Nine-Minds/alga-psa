/**
 * Drag-to-pan for the authoritative preview frame.
 *
 * At 100% a page sheet is wider than the pane it is read in, and the only scrollbar that could move
 * it sideways sits at the bottom of a frame as tall as the whole document — so reaching it means
 * scrolling past every page first. Grabbing the paper moves it instead: the frame's own document
 * sideways, and the pane the frame sits in up and down.
 *
 * Deltas are read in SCREEN coordinates. A vertical pan scrolls the host pane, which moves the frame
 * itself, so a client-space delta would measure the gesture and its own result and run at half speed.
 */

/** The host pane the frame sits in, which a vertical pan moves. */
export interface PreviewPanScroller {
  readScrollTop: () => number;
  writeScrollTop: (value: number) => void;
}

export interface PreviewPan {
  /** Re-reads what can be panned (the zoom changed, or the pane resized) and repaints the cursor. */
  refresh: () => void;
  dispose: () => void;
}

const isScrollable = (overflowY: string): boolean =>
  overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';

/**
 * The nearest ancestor of the frame that actually scrolls — in the MSP shell that is the layout's
 * body pane, not the window — falling back to the host window.
 */
export const resolvePreviewPanScroller = (element: Element | null): PreviewPanScroller => {
  const view = element?.ownerDocument?.defaultView ?? null;
  let candidate: Element | null = element?.parentElement ?? null;
  while (candidate && view) {
    const scroller = candidate;
    if (isScrollable(view.getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight) {
      return {
        readScrollTop: () => scroller.scrollTop,
        writeScrollTop: (value) => {
          scroller.scrollTop = value;
        },
      };
    }
    candidate = scroller.parentElement;
  }
  const doc = element?.ownerDocument ?? null;
  const documentScroller = doc?.scrollingElement ?? doc?.documentElement ?? null;
  return {
    readScrollTop: () => documentScroller?.scrollTop ?? view?.scrollY ?? 0,
    writeScrollTop: (value) => {
      if (view?.scrollTo) view.scrollTo({ top: value });
      else if (documentScroller) documentScroller.scrollTop = value;
    },
  };
};

/**
 * Let the author drag the preview document around inside `doc` (the frame's own document).
 *
 * The gesture is only offered when there is something to pan sideways: a fitted preview has nothing
 * off-screen, and taking the pointer there would cost the author the ability to select its text.
 */
export const attachPreviewPan = (doc: Document, scroller: PreviewPanScroller): PreviewPan => {
  const root = doc.documentElement;
  let drag: { screenX: number; screenY: number; scrollLeft: number; scrollTop: number } | null = null;

  const pannable = (): boolean => root.scrollWidth - root.clientWidth > 1;

  const paintCursor = () => {
    if (!doc.body) return;
    doc.body.style.cursor = drag ? 'grabbing' : pannable() ? 'grab' : '';
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !pannable()) return;
    drag = {
      screenX: event.screenX,
      screenY: event.screenY,
      scrollLeft: root.scrollLeft,
      scrollTop: scroller.readScrollTop(),
    };
    paintCursor();
    // Or the browser selects the document's text instead of moving it.
    event.preventDefault();
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!drag) return;
    root.scrollLeft = drag.scrollLeft - (event.screenX - drag.screenX);
    scroller.writeScrollTop(drag.scrollTop - (event.screenY - drag.screenY));
  };

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    paintCursor();
  };

  paintCursor();
  doc.addEventListener('mousedown', onMouseDown);
  doc.addEventListener('mousemove', onMouseMove);
  doc.addEventListener('mouseup', endDrag);
  // Dragging off the frame ends the gesture: a move outside it is not this document's to read, and a
  // release outside it never reaches this document at all.
  doc.addEventListener('mouseleave', endDrag);
  const hostWindow = doc.defaultView?.parent ?? null;
  hostWindow?.addEventListener('mouseup', endDrag);

  return {
    refresh: paintCursor,
    dispose: () => {
      doc.removeEventListener('mousedown', onMouseDown);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('mouseup', endDrag);
      doc.removeEventListener('mouseleave', endDrag);
      hostWindow?.removeEventListener('mouseup', endDrag);
      drag = null;
      if (doc.body) doc.body.style.cursor = '';
    },
  };
};
