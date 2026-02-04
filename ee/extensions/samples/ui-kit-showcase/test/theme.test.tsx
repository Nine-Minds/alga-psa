import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeBridge } from '../src/components/ThemeBridge';
import { App } from '../src/iframe/App';

const getThemeStyle = () => document.getElementById('alga-ui-kit-theme-bridge')?.textContent || '';

describe('theme bridge', () => {
  test('alga background maps to host background', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-bg: var(--color-background)');
  });

  test('alga foreground maps to host text color', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-fg: var(--color-text-900)');
  });

  test('alga primary maps to host primary', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-primary: var(--color-primary-500)');
  });

  test('alga border maps to host border color', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-border: var(--color-border-200)');
  });

  test('alga danger maps to host accent red', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-danger: var(--color-accent-red)');
  });

  test('dark mode declares different token values', () => {
    render(<ThemeBridge mode="dark" />);
    const style = getThemeStyle();
    expect(style).toContain(':root[data-alga-theme="dark"]');
    expect(style).toContain('--color-background: #0f172a');
  });

  test('theme toggle switches between light and dark', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(document.documentElement.getAttribute('data-alga-theme')).toBe('light');
    await user.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(document.documentElement.getAttribute('data-alga-theme')).toBe('dark');
  });

  test('theme change updates document theme attribute', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(document.documentElement.getAttribute('data-alga-theme')).toBe('dark');
  });
});
