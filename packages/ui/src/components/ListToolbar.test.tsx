// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListFilterChips, type ListFilterChip } from './ListToolbar';

afterEach(cleanup);

describe('ListFilterChips remove label', () => {
  it('uses exactly the supplied translated removeLabel as the remove button name', () => {
    const onRemove = vi.fn();
    render(
      <ListFilterChips
        chips={[{ key: 'status', label: 'Open', onRemove, removeId: 'chip-remove-status', removeLabel: 'Filter entfernen: Open' }]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Filter entfernen: Open' });
    expect(button).toHaveAttribute('aria-label', 'Filter entfernen: Open');
    fireEvent.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders no English literal of its own for the remove control', () => {
    const source = readFileSync(resolve(__dirname, 'ListToolbar.tsx'), 'utf8');
    expect(source).not.toMatch(/aria-label=["'`]Remove/);
    expect(source).toContain('aria-label={chip.removeLabel}');
  });

  it('requires removeLabel at the type level', () => {
    // @ts-expect-error removeLabel is required: the toolbar owns no strings
    const incomplete: ListFilterChip = { key: 'k', label: 'L', onRemove: () => undefined };
    expect(incomplete.key).toBe('k');
  });
});
