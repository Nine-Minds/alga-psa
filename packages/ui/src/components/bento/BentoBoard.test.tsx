// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BentoBoard, type BentoBoardTile } from './BentoBoard';
import { BentoCollapseEmptyTiles, BentoTile, BentoTileEmpty, BentoTileEmptyScope } from './BentoTile';

/**
 * The board measures its own width (not the viewport) to pick a tier. jsdom has
 * no layout and no ResizeObserver, so each test fixes the measured width.
 */
function setBoardWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 800,
    top: 0,
    left: 0,
    right: width,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

const groups = [
  { key: 'customer', label: 'Customer' },
  { key: 'work', label: 'Work' },
];

function plainTile(key: string, zone: 'start' | 'end', group: string, rank: number, pinned = false): BentoBoardTile {
  return { key, zone, group, rank, pinned, node: <div data-testid={`tile-${key}`}>{key}</div> };
}

let mounts = 0;

/** A tile whose body is either content or only its empty state; counts mounts. */
function DocsTile({ empty }: { empty: boolean }) {
  useEffect(() => {
    mounts += 1;
  }, []);
  return (
    <BentoTile id="docs" title="Documents">
      {empty ? <BentoTileEmpty id="docs-empty">No documents yet</BentoTileEmpty> : <p>report.pdf</p>}
    </BentoTile>
  );
}

function boardWithDocs(empty: boolean) {
  return (
    <BentoCollapseEmptyTiles>
      <BentoBoard
        id="board"
        main={<div data-testid="main">timeline</div>}
        groups={groups}
        emptyShelfLabel="Nothing here yet"
        tiles={[
          plainTile('contact', 'start', 'customer', 10),
          { key: 'docs', zone: 'end', group: 'work', rank: 20, node: <DocsTile empty={empty} /> },
        ]}
      />
    </BentoCollapseEmptyTiles>
  );
}

beforeEach(() => {
  mounts = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BentoBoard tiers', () => {
  it.each([
    [1500, 'wide'],
    [900, 'medium'],
    [500, 'narrow'],
  ])('picks the tier from the board width (%ipx -> %s)', (width, tier) => {
    setBoardWidth(width);
    render(
      <BentoBoard
        id="board"
        main={<div />}
        tiles={[plainTile('contact', 'start', 'customer', 10)]}
        breakpoints={{ medium: 760, wide: 1440 }}
      />,
    );
    expect(document.getElementById('board')).toHaveAttribute('data-tier', tier);
  });

  it('orders a single rail by group, then rank, with one label per group', () => {
    setBoardWidth(900);
    render(
      <BentoBoard
        id="board"
        main={<div />}
        groups={groups}
        tiles={[
          plainTile('time', 'end', 'work', 22),
          plainTile('contact', 'start', 'customer', 10),
          plainTile('sla', 'end', 'work', 20),
        ]}
        breakpoints={{ medium: 760, wide: 1440 }}
      />,
    );
    // CSS `order` sets the visual sequence; read it back per element.
    const orderOf = (el: HTMLElement | null) => Number(el?.closest('[style]')?.getAttribute('style')?.match(/order:\s*(\d+)/)?.[1]);
    const contact = orderOf(screen.getByTestId('tile-contact'));
    const sla = orderOf(screen.getByTestId('tile-sla'));
    const time = orderOf(screen.getByTestId('tile-time'));
    expect(contact).toBeLessThan(sla);
    expect(sla).toBeLessThan(time);
    expect(screen.getAllByText('Customer')).toHaveLength(1);
    expect(screen.getAllByText('Work')).toHaveLength(1);
  });

  it('switches between the main column and the side tiles at the narrow tier, keeping both mounted', () => {
    setBoardWidth(500);
    render(
      <BentoBoard
        id="board"
        main={<div data-testid="main">timeline</div>}
        tiles={[plainTile('contact', 'start', 'customer', 10)]}
        narrowTabs={{ main: 'Conversation', side: 'Details' }}
      />,
    );
    const main = screen.getByTestId('main');
    const contact = screen.getByTestId('tile-contact');
    expect(main.parentElement).not.toHaveClass('hidden');
    expect(contact.closest('.hidden')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByTestId('main')).toBe(main);
    expect(main.parentElement).toHaveClass('hidden');
    expect(contact.closest('.hidden')).toBeNull();
  });
});

describe('BentoBoard tier memory', () => {
  it('starts a re-mounted board in the tier it last measured, so its tiles mount once', () => {
    setBoardWidth(900);
    const tiles = [{ key: 'docs', zone: 'end' as const, group: 'work', rank: 20, node: <DocsTile empty={false} /> }];
    const first = render(<BentoBoard id="memory-board" main={<div />} tiles={tiles} />);
    first.unmount();
    mounts = 0;
    render(<BentoBoard id="memory-board" main={<div />} tiles={tiles} />);
    expect(document.getElementById('memory-board')).toHaveAttribute('data-tier', 'medium');
    expect(mounts).toBe(1);
  });
});

describe('BentoBoard empty-section shelf', () => {
  it('shelves a tile that reports itself empty as a chip, without remounting it', () => {
    setBoardWidth(900);
    const { rerender } = render(boardWithDocs(false));
    expect(screen.getByText('report.pdf')).toBeVisible();
    // Count from here: the first measurement may switch tiers (and remount)
    // once; the guarantee under test is that shelving never remounts.
    mounts = 0;
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();

    rerender(boardWithDocs(true));
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    // Shelved: rendered as a chip with an "open" button.
    expect(document.getElementById('docs-open')).not.toBeNull();

    rerender(boardWithDocs(false));
    expect(document.getElementById('docs-open')).toBeNull();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    expect(mounts).toBe(0);
  });

  it('keeps a section on the board once the user opens it, even while it is still empty', () => {
    setBoardWidth(900);
    render(boardWithDocs(true));
    fireEvent.click(document.getElementById('docs-open')!);
    expect(document.getElementById('docs-open')).toBeNull();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
  });

  it('scrolls the opened section into view and focuses it', () => {
    setBoardWidth(900);
    render(boardWithDocs(true));
    // The shelf sits below the board, so the card the chip expands into is off
    // screen unless the board brings it over. jsdom has no scrollIntoView.
    const slot = document.getElementById('board-slot-docs')!;
    const scrollIntoView = vi.fn();
    slot.scrollIntoView = scrollIntoView;

    fireEvent.click(document.getElementById('docs-open')!);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(slot.contains(document.activeElement)).toBe(true);
  });

  it('does not scroll or focus when a shelved section un-shelves on its own', () => {
    setBoardWidth(900);
    const { rerender } = render(boardWithDocs(true));
    const slot = document.getElementById('board-slot-docs')!;
    const scrollIntoView = vi.fn();
    slot.scrollIntoView = scrollIntoView;

    // Content arrived (the tile reports itself non-empty), not a user click.
    rerender(boardWithDocs(false));
    expect(screen.getByText('report.pdf')).toBeVisible();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(slot.contains(document.activeElement)).toBe(false);
  });
});

describe('BentoTile empty collapse', () => {
  it('collapses to its header line only under BentoCollapseEmptyTiles', () => {
    const tile = (
      <BentoTile id="calls" title="Calls">
        <BentoTileEmpty id="calls-empty">No calls logged</BentoTileEmpty>
      </BentoTile>
    );
    const { rerender } = render(tile);
    expect(document.getElementById('calls-empty-label')).toBeNull();

    rerender(<BentoCollapseEmptyTiles>{tile}</BentoCollapseEmptyTiles>);
    expect(document.getElementById('calls-empty-label')).toHaveTextContent('No calls logged');
  });

  it('does not collapse when the empty state sits inside a BentoTileEmptyScope', () => {
    render(
      <BentoCollapseEmptyTiles>
        <BentoTile id="time" title="Time">
          <p>3h logged</p>
          <BentoTileEmptyScope>
            <BentoTileEmpty id="billing-empty">Nothing billable yet</BentoTileEmpty>
          </BentoTileEmptyScope>
        </BentoTile>
      </BentoCollapseEmptyTiles>,
    );
    expect(document.getElementById('time-empty-label')).toBeNull();
    expect(screen.getByText('3h logged')).toBeVisible();
  });
});

describe('BentoTile empty reporting outside a board', () => {
  it('renders normally with no board slot', () => {
    act(() => {
      render(
        <BentoTile id="solo" title="Solo">
          <p>content</p>
        </BentoTile>,
      );
    });
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
