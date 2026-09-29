/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EntityAvatar from './EntityAvatar';

const renderAvatar = (imageUrl: string | null) =>
  render(
    <EntityAvatar
      entityId="user-1"
      entityName="Alice Wonderland"
      imageUrl={imageUrl}
      size="sm"
    />
  );

describe('EntityAvatar identity fallback', () => {
  it('shows initials while the image has not loaded yet', () => {
    renderAvatar('/api/documents/view/file-1');
    expect(screen.getByText('AW')).toBeTruthy();
    expect(screen.getByRole('img', { hidden: true }).className).toContain('opacity-0');
  });

  it('keeps the initials when the image request fails', () => {
    renderAvatar('/api/documents/view/missing-file');
    fireEvent.error(screen.getByRole('img', { hidden: true }));
    expect(screen.getByText('AW')).toBeTruthy();
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });

  it('falls back to initials when the request already failed before the handlers attached', () => {
    const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const naturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 0 });

    try {
      renderAvatar('/api/documents/view/missing-file');
      // No error event is ever dispatched — the element state alone must resolve it.
      expect(screen.getByText('AW')).toBeTruthy();
      expect(screen.queryByRole('img', { hidden: true })).toBeNull();
    } finally {
      if (complete) Object.defineProperty(HTMLImageElement.prototype, 'complete', complete);
      if (naturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', naturalWidth);
    }
  });

  it('reveals the image and drops the initials once it loads', () => {
    renderAvatar('/api/documents/view/file-1');
    fireEvent.load(screen.getByRole('img', { hidden: true }));
    expect(screen.queryByText('AW')).toBeNull();
    expect(screen.getByRole('img', { hidden: true }).className).toContain('opacity-100');
  });

  it('renders initials without an image element when there is no avatar', () => {
    renderAvatar(null);
    expect(screen.getByText('AW')).toBeTruthy();
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });
});
