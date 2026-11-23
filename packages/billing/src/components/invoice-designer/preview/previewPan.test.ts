// @vitest-environment jsdom

/**
 * The preview is dragged, not chased: a sheet wider than the pane can only be scrolled sideways by a
 * scrollbar that sits below every page of the document, so grabbing the paper has to move it.
 *
 * jsdom has no layout, so the metrics a real frame measures (scrollWidth, clientWidth) and the scroll
 * offsets a real browser owns are declared here.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { attachPreviewPan, resolvePreviewPanScroller, type PreviewPan, type PreviewPanScroller } from './previewPan';

const state = (value: number) => ({ configurable: true, writable: true, value });

const widthOf = (element: Element, scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(element, 'scrollLeft', state(0));
};

const mouse = (type: string, screenX: number, screenY: number, button = 0): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button, screenX, screenY });

const hostScroller = (): PreviewPanScroller & { top: number } => {
  const scroller = {
    top: 0,
    readScrollTop: () => scroller.top,
    writeScrollTop: (value: number) => {
      scroller.top = value;
    },
  };
  return scroller;
};

let pan: PreviewPan | null = null;

afterEach(() => {
  pan?.dispose();
  pan = null;
  document.body.innerHTML = '';
});

describe('dragging the preview', () => {
  it('moves the frame sideways and the pane it sits in up and down', () => {
    widthOf(document.documentElement, 900, 600);
    const scroller = hostScroller();
    scroller.top = 400;
    pan = attachPreviewPan(document, scroller);

    document.body.dispatchEvent(mouse('mousedown', 500, 300));
    document.body.dispatchEvent(mouse('mousemove', 440, 260));

    // Drag left by 60 and up by 40: the paper follows the hand, so the document scrolls the other way.
    expect(document.documentElement.scrollLeft).toBe(60);
    expect(scroller.top).toBe(440);

    document.body.dispatchEvent(mouse('mousemove', 560, 340));
    expect(document.documentElement.scrollLeft).toBe(-60);
    expect(scroller.top).toBe(360);

    document.body.dispatchEvent(mouse('mouseup', 560, 340));
    document.body.dispatchEvent(mouse('mousemove', 300, 100));
    expect(document.documentElement.scrollLeft).toBe(-60);
    expect(scroller.top).toBe(360);
  });

  it('takes the pointer only when there is something off-screen to reach', () => {
    widthOf(document.documentElement, 600, 600);
    const scroller = hostScroller();
    pan = attachPreviewPan(document, scroller);
    expect(document.body.style.cursor).toBe('');

    const down = mouse('mousedown', 500, 300);
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(mouse('mousemove', 400, 200));

    // A fitted preview is text to select, not a map to drag.
    expect(down.defaultPrevented).toBe(false);
    expect(document.documentElement.scrollLeft).toBe(0);
    expect(scroller.top).toBe(0);
  });

  it('offers the grab cursor while the paper is bigger than the pane, and gives it back', () => {
    widthOf(document.documentElement, 900, 600);
    pan = attachPreviewPan(document, hostScroller());
    expect(document.body.style.cursor).toBe('grab');

    const down = mouse('mousedown', 500, 300);
    document.body.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.body.style.cursor).toBe('grabbing');

    document.body.dispatchEvent(mouse('mouseup', 500, 300));
    expect(document.body.style.cursor).toBe('grab');

    pan.dispose();
    pan = null;
    expect(document.body.style.cursor).toBe('');
  });

  it('re-reads what can be panned when the zoom changes', () => {
    widthOf(document.documentElement, 600, 600);
    pan = attachPreviewPan(document, hostScroller());
    expect(document.body.style.cursor).toBe('');

    widthOf(document.documentElement, 1200, 600);
    pan.refresh();
    expect(document.body.style.cursor).toBe('grab');
  });

  it('ends the drag when the mouse leaves the frame', () => {
    widthOf(document.documentElement, 900, 600);
    const scroller = hostScroller();
    pan = attachPreviewPan(document, scroller);

    document.body.dispatchEvent(mouse('mousedown', 500, 300));
    document.dispatchEvent(mouse('mouseleave', 500, 300));
    document.body.dispatchEvent(mouse('mousemove', 300, 300));

    expect(document.documentElement.scrollLeft).toBe(0);
    expect(document.body.style.cursor).toBe('grab');
  });
});

describe('the pane a vertical pan scrolls', () => {
  it('is the nearest scrolling ancestor, not the window', () => {
    const pane = document.createElement('div');
    pane.style.overflowY = 'auto';
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(pane, 'scrollTop', state(120));
    const frame = document.createElement('iframe');
    pane.appendChild(frame);
    document.body.appendChild(pane);

    const scroller = resolvePreviewPanScroller(frame);
    expect(scroller.readScrollTop()).toBe(120);
    scroller.writeScrollTop(300);
    expect(pane.scrollTop).toBe(300);
  });

  it('falls back to the document when no ancestor scrolls', () => {
    const still = document.createElement('div');
    Object.defineProperty(still, 'scrollHeight', { configurable: true, value: 600 });
    Object.defineProperty(still, 'clientHeight', { configurable: true, value: 600 });
    const frame = document.createElement('iframe');
    still.appendChild(frame);
    document.body.appendChild(still);
    Object.defineProperty(document.scrollingElement ?? document.documentElement, 'scrollTop', state(64));

    expect(resolvePreviewPanScroller(frame).readScrollTop()).toBe(64);
  });
});
