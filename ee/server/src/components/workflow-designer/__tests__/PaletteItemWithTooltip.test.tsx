/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraggableProvided } from '@hello-pangea/dnd';

import { PaletteItemWithTooltip, type PaletteTooltipItem } from '../PaletteItemWithTooltip';

const item: PaletteTooltipItem = {
  id: 'ticket',
  label: 'Ticket',
  description: 'Ticket actions',
  type: 'action.call',
  groupKey: 'ticket',
  iconToken: 'ticket',
  tileKind: 'core-object',
};

const createProvided = (): DraggableProvided =>
  ({
    innerRef: () => undefined,
    draggableProps: {
      'data-rbd-draggable-context-id': 'palette',
      'data-rbd-draggable-id': 'palette:ticket',
      style: {},
      onTransitionEnd: () => undefined,
    },
    dragHandleProps: {
      'data-rbd-drag-handle-draggable-id': 'palette:ticket',
      'data-rbd-drag-handle-context-id': 'palette',
      tabIndex: 0,
      role: 'button',
      'aria-describedby': 'palette-item-ticket',
      draggable: false,
      onDragStart: () => undefined,
    },
  }) as unknown as DraggableProvided;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PaletteItemWithTooltip', () => {
  it('T033: keeps the grouped tile icon stable across click and drag presentation states', () => {
    const onClick = vi.fn();
    const { getByTestId, rerender } = render(
      <PaletteItemWithTooltip
        item={item}
        icon={<svg data-testid="ticket-icon" />}
        isDragging={false}
        provided={createProvided()}
        onClick={onClick}
      />
    );

    fireEvent.click(getByTestId('palette-item-ticket'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(getByTestId('ticket-icon')).toBeInTheDocument();

    rerender(
      <PaletteItemWithTooltip
        item={item}
        icon={<svg data-testid="ticket-icon" />}
        isDragging={true}
        provided={createProvided()}
        onClick={onClick}
      />
    );

    expect(getByTestId('ticket-icon')).toBeInTheDocument();
  });

  it('T034: keeps the grouped tile label and description stable in tooltip content', async () => {
    vi.useFakeTimers();
    render(
      <PaletteItemWithTooltip
        item={item}
        icon={<svg data-testid="ticket-icon" />}
        isDragging={false}
        provided={createProvided()}
        onClick={vi.fn()}
      />
    );

    fireEvent.mouseEnter(screen.getByTestId('palette-item-ticket'));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(screen.getByText('Ticket')).toBeInTheDocument();
    expect(screen.getByText('Ticket actions')).toBeInTheDocument();
  });
});
