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
    expect(getThemeStyle()).toContain('--alga-bg: #ffffff');
  });

  test('alga foreground maps to host text color', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-fg: #111111');
  });

  test('alga primary maps to host primary', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-primary: #9855ee');
  });

  test('alga border maps to host border color', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-border: #e5e7eb');
  });

  test('alga danger maps to host accent red', () => {
    render(<ThemeBridge mode="light" />);
    expect(getThemeStyle()).toContain('--alga-danger: #dc2626');
  });

  test('dark mode declares different token values', () => {
    render(<ThemeBridge mode="dark" />);
    const style = getThemeStyle();
    expect(style).toContain(':root[data-alga-theme="dark"]');
    expect(style).toContain('--alga-bg: #0b0f14');
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
