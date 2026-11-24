// @vitest-environment jsdom
/**
 * The fitted designer height: the hook hands back the height that makes the element, and the
 * page chrome under it, end exactly where its scroll container ends.
 */
import React, { useRef } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFitToAvailableHeight } from './useFitToAvailableHeight';

interface Geometry {
  areaTop: number;
  areaHeight: number;
  cardPaddingBottom: number;
  containerTop: number;
  containerClientHeight: number;
  containerPaddingBottom: number;
}

function Harness({ enabled = true, minHeight = 320 }: { enabled?: boolean; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useFitToAvailableHeight(ref, { enabled, minHeight });

  return (
    <div id="scroll-container" style={{ overflowY: 'auto', paddingBottom: '24px' }}>
      <div id="card">
        <div id="designer-area" ref={ref} data-height={height === null ? '' : String(height)} />
      </div>
    </div>
  );
}

const measuredHeight = () => document.getElementById('designer-area')?.getAttribute('data-height');

const stubGeometry = (geometry: Geometry) => {
  const container = document.getElementById('scroll-container') as HTMLElement;
  const card = document.getElementById('card') as HTMLElement;
  const area = document.getElementById('designer-area') as HTMLElement;

  Object.defineProperty(container, 'clientHeight', { configurable: true, value: geometry.containerClientHeight });
  container.getBoundingClientRect = () =>
    ({ top: geometry.containerTop, height: geometry.containerClientHeight } as DOMRect);
  area.getBoundingClientRect = () =>
    ({
      top: geometry.areaTop,
      height: geometry.areaHeight,
      bottom: geometry.areaTop + geometry.areaHeight,
    } as DOMRect);
  card.getBoundingClientRect = () =>
    ({ bottom: geometry.areaTop + geometry.areaHeight + geometry.cardPaddingBottom } as DOMRect);

  window.dispatchEvent(new Event('resize'));
};

// A 900px window: 66px of app header above the scroll container, 24px of page padding below
// the card, and the card's own 24px under the designer.
const window900 = (areaHeight: number): Geometry => ({
  areaTop: 420,
  areaHeight,
  cardPaddingBottom: 24,
  containerTop: 66,
  containerClientHeight: 834,
  containerPaddingBottom: 24,
});

afterEach(() => {
  cleanup();
});

describe('useFitToAvailableHeight', () => {
  it('shrinks an area that overflows the page down to the room it has', async () => {
    render(<Harness />);
    // 504px is what the viewport-budget height gives on a 900px window, and it overflows.
    stubGeometry(window900(504));

    await waitFor(() => expect(measuredHeight()).toBe('432'));
  });

  it('grows an area that leaves room unused to the same fit', async () => {
    render(<Harness />);
    stubGeometry(window900(300));

    await waitFor(() => expect(measuredHeight()).toBe('432'));
  });

  it('never goes below the floor, leaving a very short window to scroll', async () => {
    render(<Harness />);
    stubGeometry({ ...window900(504), containerClientHeight: 300 });

    await waitFor(() => expect(measuredHeight()).toBe('320'));
  });

  it('measures nothing while disabled', async () => {
    render(<Harness enabled={false} />);
    stubGeometry(window900(504));

    await waitFor(() => expect(measuredHeight()).toBe(''));
  });
});
