/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useRangeSelection } from './useRangeSelection';

afterEach(() => {
  cleanup();
});

function Harness({ initial = new Set<string>() }: { initial?: Set<string> }) {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const [selected, setSelected] = useState<Set<string>>(initial);
  const rangeSelect = useRangeSelection<string>({
    items,
    getId: (id) => id,
    selectedIds: selected,
    onSelectedIdsChange: (next) => setSelected(next),
  });

  return (
    <div>
      <span data-testid="selected">{Array.from(selected).sort().join(',')}</span>
      {items.map((id) => (
        <button
          key={id}
          data-testid={`row-${id}`}
          data-selected={rangeSelect.isSelected(id)}
          onClick={(event) => {
            rangeSelect.handleSelect(id, {
              shiftKey: event.shiftKey,
              selected: !selected.has(id),
              preventDefault: () => event.preventDefault(),
            });
          }}
        >
          {id}
        </button>
      ))}
    </div>
  );
}

describe('useRangeSelection', () => {
  it('toggles a single id on plain click', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('row-b'));
    expect(getByTestId('selected').textContent).toBe('b');
    fireEvent.click(getByTestId('row-b'));
    expect(getByTestId('selected').textContent).toBe('');
  });

  it('selects an inclusive forward range on shift-click after an anchor', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('row-b'));
    fireEvent.click(getByTestId('row-d'), { shiftKey: true });
    expect(getByTestId('selected').textContent).toBe('b,c,d');
  });

  it('selects an inclusive reverse range on shift-click', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('row-d'));
    fireEvent.click(getByTestId('row-a'), { shiftKey: true });
    expect(getByTestId('selected').textContent).toBe('a,b,c,d');
  });

  it('adds shift-range to existing selection (additive)', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('row-a'));
    fireEvent.click(getByTestId('row-a'));
    fireEvent.click(getByTestId('row-e'));
    fireEvent.click(getByTestId('row-c'), { shiftKey: true });
    expect(getByTestId('selected').textContent).toBe('c,d,e');
  });

  it('removes an inclusive range when shift-clicking a selected row', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('row-a'));
    fireEvent.click(getByTestId('row-e'), { shiftKey: true });
    expect(getByTestId('selected').textContent).toBe('a,b,c,d,e');
    fireEvent.click(getByTestId('row-c'), { shiftKey: true });
    expect(getByTestId('selected').textContent).toBe('a,b');
  });

  it('falls back to single toggle when no anchor exists', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('row-c'), { shiftKey: true });
    expect(getByTestId('selected').textContent).toBe('c');
  });

  it('moves the anchor to the most recently clicked row', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.click(getByTestId('row-a'));
    fireEvent.click(getByTestId('row-c'), { shiftKey: true });
    fireEvent.click(getByTestId('row-e'), { shiftKey: true });
    expect(getByTestId('selected').textContent).toBe('a,b,c,d,e');
  });
});
