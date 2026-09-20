/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SystemAvatar from './SystemAvatar';

describe('SystemAvatar', () => {
  it('renders a glyph instead of initials and exposes the label', () => {
    const { container } = render(<SystemAvatar glyph="system" label="System" size="md" />);

    const root = screen.getByRole('img', { name: 'System' });
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-avatar-kind')).toBe('system');
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.textContent?.trim()).toBe('');
  });

  it('selects the glyph by kind', () => {
    const { container: system } = render(<SystemAvatar glyph="system" label="System" />);
    expect(system.querySelector('.lucide-cog')).toBeTruthy();
    expect(system.querySelector('.lucide-layers')).toBeNull();

    const { container: bundle } = render(<SystemAvatar glyph="bundle" label="Bundled update" />);
    const bundleRoot = screen.getByRole('img', { name: 'Bundled update' });
    expect(bundleRoot.getAttribute('data-avatar-kind')).toBe('bundle');
    expect(bundle.querySelector('.lucide-layers')).toBeTruthy();
    expect(bundle.querySelector('.lucide-cog')).toBeNull();
  });

  it('follows the shared size-to-shape rule', () => {
    const { container: xs } = render(<SystemAvatar glyph="system" label="System" size="xs" />);
    expect(xs.firstElementChild?.className).toContain('rounded-md');
    expect(xs.firstElementChild?.className).toContain('h-6');

    const { container: md } = render(<SystemAvatar glyph="system" label="System" size="md" />);
    expect(md.firstElementChild?.className).toContain('rounded-full');
    expect(md.firstElementChild?.className).toContain('h-10');
  });
});
