'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BentoBoardSlotContext } from './BentoTile';
import ViewSwitcher from '../ViewSwitcher';

/**
 * One side tile on a bento board. Tiles declare *what* they are (which side
 * they belong to, how important they are); the board decides *where* they go
 * for the width it actually has.
 */
export interface BentoBoardTile {
  key: string;
  /** Column at the wide tier: 'start' (left of main) or 'end' (right of main). */
  zone: 'start' | 'end';
  /** Lower ranks come first whenever tiles share a column. */
  rank: number;
  /** At the narrow tier, render above the main column instead of below it. */
  pinned?: boolean;
  /** Section the tile belongs to (see BentoBoard `groups`). */
  group?: string;
  node: React.ReactNode;
}

export type BentoBoardTier = 'narrow' | 'medium' | 'wide';

interface BentoBoardProps {
  id: string;
  main: React.ReactNode;
  tiles: BentoBoardTile[];
  /**
   * Ordered, labelled sections. Tiles are ordered by section, then rank, and
   * each run of a section in a column gets the section's eyebrow label.
   */
  groups?: { key: string; label: string }[];
  /**
   * Narrow tier: switch between the main column and the side tiles instead of
   * stacking the tiles under a long main column. Both stay mounted.
   */
  narrowTabs?: { main: string; side: string };
  /** Heading over the shelf of sections that currently have nothing in them. */
  emptyShelfLabel?: string;
  /** Board widths (px) at which the medium and wide tiers start. */
  breakpoints?: { medium: number; wide: number };
}

/**
 * Last measured tier per board id. The first render can't measure, and a tier
 * change remounts the tiles (they move between columns), so start from the
 * tier this board last had: only the first view after a page load pays it.
 */
const lastTierByBoard = new Map<string, BentoBoardTier>();

function tierFor(width: number, bp: { medium: number; wide: number }): BentoBoardTier {
  if (width >= bp.wide) return 'wide';
  if (width >= bp.medium) return 'medium';
  return 'narrow';
}

/** Id of the wrapper the board scrolls to and focuses when a section is opened. */
function slotElementId(boardId: string, tileKey: string) {
  return `${boardId}-slot-${tileKey}`;
}

function Column({
  boardId,
  tiles,
  labels,
  empty,
  onSlotEmpty,
  onSlotOpen,
  emptyLabel,
}: {
  boardId: string;
  tiles: BentoBoardTile[];
  labels: Map<string, string>;
  empty: Set<string>;
  onSlotEmpty: (key: string, isEmpty: boolean) => void;
  onSlotOpen: (key: string) => void;
  emptyLabel?: string;
}) {
  // One flex parent with CSS `order`, so moving a tile between the live list
  // and the empty shelf never remounts it (which would refetch and flicker).
  const live = tiles.filter((tile) => !empty.has(tile.key));
  const order = new Map<string, number>();
  const eyebrows: { key: string; label: string; order: number }[] = [];
  live.forEach((tile, index) => {
    order.set(tile.key, index * 2 + 1);
    const label = tile.group ? labels.get(tile.group) : undefined;
    if (label && live[index - 1]?.group !== tile.group) {
      eyebrows.push({ key: `eyebrow-${tile.group}`, label, order: index * 2 });
    }
  });
  let shelfIndex = 0;
  for (const tile of tiles) {
    if (empty.has(tile.key)) order.set(tile.key, 10000 + shelfIndex++);
  }
  return (
    // Wrapping flex: live tiles and headings take the full row; shelved
    // sections flow as a row of chips.
    <div className="min-w-0 flex flex-wrap gap-x-2 gap-y-4 [&>*]:min-w-0">
      {eyebrows.map((eyebrow, index) => (
        <h3
          key={eyebrow.key}
          style={{ order: eyebrow.order }}
          // Pulled toward the section it labels (closer to its cards than cards are to each other).
          className={`basis-full -mb-2 text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] px-1 ${index > 0 ? 'pt-3' : ''}`}
        >
          {eyebrow.label}
        </h3>
      ))}
      {shelfIndex > 0 && emptyLabel ? (
        <h3 style={{ order: 9999 }} className="basis-full -mb-2 text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] px-1 pt-2">
          {emptyLabel}
        </h3>
      ) : null}
      {tiles.map((tile) => (
        <div
          key={tile.key}
          id={slotElementId(boardId, tile.key)}
          // Programmatic focus target when the board opens this section; never in the tab order.
          tabIndex={-1}
          style={{ order: order.get(tile.key) }}
          className={empty.has(tile.key) ? '-mt-2' : 'basis-full'}
        >
          <BentoBoardSlot tileKey={tile.key} shelved={empty.has(tile.key)} onSlotEmpty={onSlotEmpty} onSlotOpen={onSlotOpen}>
            {tile.node}
          </BentoBoardSlot>
        </div>
      ))}
    </div>
  );
}

function BentoBoardSlot({
  tileKey,
  shelved,
  onSlotEmpty,
  onSlotOpen,
  children,
}: {
  tileKey: string;
  shelved: boolean;
  onSlotEmpty: (key: string, isEmpty: boolean) => void;
  onSlotOpen: (key: string) => void;
  children: React.ReactNode;
}) {
  const report = useCallback((isEmpty: boolean) => onSlotEmpty(tileKey, isEmpty), [onSlotEmpty, tileKey]);
  const open = useCallback(() => onSlotOpen(tileKey), [onSlotOpen, tileKey]);
  const value = useMemo(() => ({ report, shelved, open }), [report, shelved, open]);
  return <BentoBoardSlotContext.Provider value={value}>{children}</BentoBoardSlotContext.Provider>;
}

/**
 * Responsive main-plus-rails layout, measured against the board's own width
 * (not the viewport), so app chrome and drawers never squeeze three columns.
 *
 * - wide: start rail | main | end rail
 * - medium: main | one rail holding every tile in rank order
 * - narrow: pinned tiles, then main, then the rest, in rank order
 */
export function BentoBoard({ id, main, tiles, groups = [], emptyShelfLabel, narrowTabs, breakpoints = { medium: 760, wide: 1180 } }: BentoBoardProps) {
  const [narrowPane, setNarrowPane] = useState<'main' | 'side'>('main');
  const ref = useRef<HTMLDivElement>(null);
  const [tier, setTier] = useState<BentoBoardTier>(() => lastTierByBoard.get(id) ?? 'wide');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = tierFor(el.getBoundingClientRect().width, breakpoints);
      lastTierByBoard.set(id, next);
      setTier(next);
    };
    update();
    // No ResizeObserver (older runtimes, jsdom): keep the first measurement.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, breakpoints.medium, breakpoints.wide]);

  const [empty, setEmpty] = useState<Set<string>>(() => new Set());
  const onSlotEmpty = useCallback((key: string, isEmpty: boolean) => {
    setEmpty((current) => {
      if (current.has(key) === isEmpty) return current;
      const next = new Set(current);
      if (isEmpty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  // Sections the user opened stay on the board even while still empty.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  // The key the user just opened, so content arriving on its own (report(false))
  // never yanks the page around — only a deliberate open does.
  const pendingOpenRef = useRef<string | null>(null);
  const onSlotOpen = useCallback((key: string) => {
    pendingOpenRef.current = key;
    setOpened((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);
  // Same commit the slot turns from a chip into a full card: bring it into view.
  useEffect(() => {
    const key = pendingOpenRef.current;
    if (!key || !opened.has(key)) return;
    pendingOpenRef.current = null;
    const el = document.getElementById(slotElementId(id, key));
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }, [opened, id]);
  const shelved = new Set([...empty].filter((key) => !opened.has(key)));
  const columnProps = { boardId: id, labels: new Map<string, string>(), empty: shelved, onSlotEmpty, onSlotOpen, emptyLabel: emptyShelfLabel };

  const groupOrder = new Map(groups.map((group, index) => [group.key, index]));
  const labels = new Map(groups.map((group) => [group.key, group.label]));
  const sectionOf = (tile: BentoBoardTile) => (tile.group ? groupOrder.get(tile.group) ?? groups.length : groups.length);
  const ranked = [...tiles].sort((a, b) => sectionOf(a) - sectionOf(b) || a.rank - b.rank);
  const byRank = [...tiles].sort((a, b) => a.rank - b.rank);

  let body: React.ReactNode;
  if (tier === 'wide') {
    body = (
      <div className="grid gap-4 items-start grid-cols-[minmax(260px,1fr)_minmax(0,2fr)_minmax(260px,1fr)]">
        <Column {...columnProps} labels={labels} tiles={ranked.filter((tile) => tile.zone === 'start')} />
        <div className="min-w-0">{main}</div>
        <Column {...columnProps} labels={labels} tiles={ranked.filter((tile) => tile.zone === 'end')} />
      </div>
    );
  } else if (tier === 'medium') {
    body = (
      <div className="grid gap-4 items-start grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0">{main}</div>
        <Column {...columnProps} labels={labels} tiles={ranked} />
      </div>
    );
  } else if (narrowTabs) {
    body = (
      <div className="space-y-3">
        <Column {...columnProps} emptyLabel={undefined} tiles={byRank.filter((tile) => tile.pinned)} />
        <ViewSwitcher<'main' | 'side'>
          currentView={narrowPane}
          onChange={setNarrowPane}
          size="sm"
          className="w-fit"
          options={[
            { value: 'main', label: narrowTabs.main, id: `${id}-pane-main` },
            { value: 'side', label: narrowTabs.side, id: `${id}-pane-side` },
          ]}
        />
        <div className={narrowPane === 'main' ? 'min-w-0' : 'hidden'}>{main}</div>
        <div className={narrowPane === 'side' ? 'min-w-0' : 'hidden'}>
          <Column {...columnProps} labels={labels} tiles={ranked.filter((tile) => !tile.pinned)} />
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <Column {...columnProps} emptyLabel={undefined} tiles={byRank.filter((tile) => tile.pinned)} />
        <div className="min-w-0">{main}</div>
        <Column {...columnProps} labels={labels} tiles={ranked.filter((tile) => !tile.pinned)} />
      </div>
    );
  }

  return (
    <div id={id} ref={ref} data-tier={tier} className="min-w-0">
      {body}
    </div>
  );
}

export default BentoBoard;
