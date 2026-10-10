/**
 * @vitest-environment jsdom
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QuantityInput } from './QuantityInput';

// Mirrors the wizard handlers: unit rows floor and clamp at 0, allocation rows clamp at 1.
function Harness({ unit, initial, commits }: { unit: boolean; initial: number; commits: number[] }) {
  const [value, setValue] = useState(initial);
  return (
    <QuantityInput
      id="qty"
      value={value}
      min={unit ? 0 : 1}
      onCommit={(raw) => {
        const next = unit ? Math.max(0, Math.floor(raw)) : Math.max(1, raw || 1);
        commits.push(next);
        setValue(next);
      }}
    />
  );
}

const field = () => screen.getByRole('spinbutton') as HTMLInputElement;

describe('QuantityInput', () => {
  afterEach(cleanup);

  it('lets the field be cleared and retyped: "1" -> "" -> "2" -> "20"', () => {
    const commits: number[] = [];
    render(<Harness unit initial={1} commits={commits} />);

    fireEvent.change(field(), { target: { value: '' } });
    expect(field().value).toBe('');
    expect(commits).toEqual([]);

    fireEvent.change(field(), { target: { value: '2' } });
    expect(field().value).toBe('2');
    fireEvent.change(field(), { target: { value: '20' } });
    expect(field().value).toBe('20');
    expect(commits).toEqual([2, 20]);
  });

  it('commits an explicit 0 for unit rows and never clamps it to 1', () => {
    const commits: number[] = [];
    render(<Harness unit initial={3} commits={commits} />);

    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.change(field(), { target: { value: '0' } });

    expect(commits).toEqual([0]);
    expect(field().value).toBe('0');
  });

  it('floors non-integers for unit rows', () => {
    const commits: number[] = [];
    render(<Harness unit initial={1} commits={commits} />);
    fireEvent.change(field(), { target: { value: '2.7' } });
    expect(commits).toEqual([2]);
  });

  it('keeps the allocation minimum of 1', () => {
    const commits: number[] = [];
    render(<Harness unit={false} initial={4} commits={commits} />);
    expect(field()).toHaveAttribute('min', '1');
    fireEvent.change(field(), { target: { value: '0' } });
    expect(commits).toEqual([1]);
    fireEvent.blur(field());
    expect(field().value).toBe('1');
  });

  it('reverts an empty field to the committed value on blur without committing', () => {
    const onCommit = vi.fn();
    render(<QuantityInput id="qty" value={7} min={0} onCommit={onCommit} />);

    fireEvent.change(field(), { target: { value: '' } });
    expect(field().value).toBe('');
    fireEvent.blur(field());

    expect(field().value).toBe('7');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
