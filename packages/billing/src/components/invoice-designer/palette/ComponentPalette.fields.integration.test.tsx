// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentPalette } from './ComponentPalette';

afterEach(() => {
  cleanup();
});

describe('ComponentPalette fields tab', () => {
  it('inserts a selected template variable via callback', () => {
    const onInsertTemplateVariable = vi.fn();

    render(
      <DndContext>
        <ComponentPalette onInsertTemplateVariable={onInsertTemplateVariable} />
      </DndContext>
    );

    fireEvent.click(screen.getByRole('button', { name: 'FIELDS' }));
    fireEvent.click(screen.getByRole('button', { name: /Tenant Address/i }));

    expect(onInsertTemplateVariable).toHaveBeenCalledTimes(1);
    expect(onInsertTemplateVariable).toHaveBeenCalledWith('tenant.address');
  });

  it('filters template variables by search query', () => {
    render(
      <DndContext>
        <ComponentPalette />
      </DndContext>
    );

    fireEvent.click(screen.getByRole('button', { name: 'FIELDS' }));
    fireEvent.change(screen.getByPlaceholderText('Search fields...'), {
      target: { value: 'currency' },
    });

    expect(screen.getByText('Currency Code')).toBeTruthy();
    expect(screen.queryByText('Tenant Address')).toBeNull();
  });

  it('keeps address field descriptions neutral in the fields tab', () => {
    render(
      <DndContext>
        <ComponentPalette />
      </DndContext>
    );

    fireEvent.click(screen.getByRole('button', { name: 'FIELDS' }));

    expect(screen.getByText('The customer billing address.')).toBeTruthy();
    expect(screen.queryByText(/property panel/i)).toBeNull();
  });
});
