/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bindingToAriaKeyShortcuts, formatShortcut, Kbd, ShortcutHelpDialog } from './index';

describe('shortcut display helpers', () => {
  it('formats bindings for mac and other platforms', () => {
    expect(formatShortcut('mod+shift+k', 'mac')).toBe('⌘⇧k');
    expect(formatShortcut('mod+shift+k', 'other')).toBe('Ctrl+Shift+k');
  });

  it('converts bindings to aria-keyshortcuts format', () => {
    expect(bindingToAriaKeyShortcuts('mod+k', 'other')).toBe('Control+K');
    expect(bindingToAriaKeyShortcuts('mod+shift+k', 'mac')).toBe('Meta+Shift+K');
  });

  it('renders Kbd and help dialog entries', () => {
    render(
      <>
        <Kbd binding="mod+k" />
        <ShortcutHelpDialog isOpen onClose={() => undefined} disabledActionIds={['global.quickCreate']} />
      </>,
    );
    expect(screen.getAllByText(/Ctrl/).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('global.quickCreate')).toBeNull();
  });
});
