/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IBoard } from '@alga-psa/types';
import { BoardPicker } from './BoardPicker';

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: () => ({}),
}));

const boards: IBoard[] = [
  {
    board_id: 'board-1',
    board_name: 'Support',
    is_inactive: false,
  } as IBoard,
];

describe('BoardPicker keyboard behavior', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 40,
      top: 0,
      left: 0,
      right: 240,
      bottom: 40,
      toJSON: () => ({}),
    } as DOMRect);
  });

  const renderPicker = (props: Partial<React.ComponentProps<typeof BoardPicker>> = {}) => {
    return render(
      <BoardPicker
        boards={boards}
        onSelect={vi.fn()}
        selectedBoardId={null}
        filterState="active"
        onFilterStateChange={vi.fn()}
        placeholder="Select Board"
        {...props}
      />,
    );
  };

  it('opens with ArrowDown from the trigger and focuses search', async () => {
    renderPicker();

    fireEvent.keyDown(screen.getByRole('button', { name: /select board/i }), { key: 'ArrowDown' });

    expect(screen.getByRole('listbox', { name: /boards/i })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText(/search boards/i));
    });
  });

  it('makes board options keyboard focusable and selectable with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderPicker({ onSelect });

    await user.click(screen.getByRole('button', { name: /select board/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText(/search boards/i));
    });
    // The picker schedules its own requestAnimationFrame to focus the search
    // input on open; flush it so it cannot steal focus from the option below.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    const option = screen.getByRole('option', { name: /support/i });
    expect(option).toHaveProperty('tabIndex', 0);
    option.focus();
    expect(document.activeElement).toBe(option);

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('board-1');
    expect(screen.queryByRole('listbox', { name: /boards/i })).toBeNull();
  });
});
