// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentPalette } from './ComponentPalette';

afterEach(() => {
  cleanup();
});

/**
 * A layout editor fitted to a small window hands the palette far less height than the
 * invoice designer's 480 px floor ever did. jsdom computes no flex, so these assert the
 * CSS contract that decides the split: the block list owns a pixel floor and the outline
 * owns none, so the outline is the pane that yields. Before this, the outline's 180 px
 * floor took the whole column and the block list collapsed to zero height, which put the
 * + buttons under the search box and out of reach.
 */
describe('ComponentPalette in a short palette column', () => {
  const renderPalette = (onInsertComponent = vi.fn()) => {
    render(
      <DndContext>
        <ComponentPalette onInsertComponent={onInsertComponent} />
      </DndContext>
    );
    return onInsertComponent;
  };

  it('keeps a floor under the block list and lets the outline pane shrink to nothing', () => {
    renderPalette();

    const listPane = document.querySelector('[data-automation-id="designer-palette-list-pane"]');
    const outlinePane = document.querySelector('[data-automation-id="designer-palette-outline-pane"]');

    expect(listPane?.className).toContain('flex-1');
    expect(listPane?.className).toContain('min-h-[7rem]');
    expect(listPane?.className).toContain('overflow-y-auto');

    // The outline asks for a share of the column (42%) but concedes all of it when the
    // column is short: a pixel floor here is what starved the list.
    expect(outlinePane?.className).toContain('h-[42%]');
    expect(outlinePane?.className).toContain('min-h-0');
    expect(outlinePane?.className).not.toMatch(/min-h-\[\d/);
  });

  it('keeps the outline toggle itself from being squeezed away', () => {
    renderPalette();

    const toggle = document.getElementById('designer-outline-toggle');

    expect(toggle?.className).toContain('shrink-0');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('drops its height claim entirely once the outline is collapsed', () => {
    renderPalette();

    fireEvent.click(screen.getByRole('button', { name: /OUTLINE/ }));

    const outlinePane = document.querySelector('[data-automation-id="designer-palette-outline-pane"]');
    expect(outlinePane?.className).not.toContain('h-[42%]');
    expect(document.querySelector('[role="tree"]')).toBeNull();
  });

  it('still adds a searched block from the filtered list', () => {
    const onInsertComponent = renderPalette();

    fireEvent.change(screen.getByPlaceholderText('Search blocks...'), { target: { value: 'Text Block' } });

    const addButton = document.querySelector('[data-automation-id="designer-palette-add-text"]');
    expect(addButton).toBeTruthy();

    fireEvent.click(addButton as HTMLElement);

    expect(onInsertComponent).toHaveBeenCalledWith('text', { after: false });
  });
});
