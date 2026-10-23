/** @vitest-environment jsdom */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ value: '/auth/msp/signin' }));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: undefined }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
}));
vi.mock('@mantine/core', () => ({
  MantineProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@radix-ui/themes', () => ({
  Theme: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ThemeBridge } from './ThemeBridge';

describe('ThemeBridge sign-in visibility', () => {
  it('does not hide login controls during server render', () => {
    pathname.value = '/auth/msp/signin';
    const markup = renderToString(
      <ThemeBridge>
        <input aria-label="Email" />
      </ThemeBridge>,
    );

    expect(markup).toContain('aria-label="Email"');
    expect(markup).not.toContain('visibility:hidden');
  });

  it('retains the pre-mount visibility gate outside sign-in', () => {
    pathname.value = '/msp/dashboard';
    const markup = renderToString(
      <ThemeBridge>
        <div>Dashboard</div>
      </ThemeBridge>,
    );

    expect(markup).toContain('visibility:hidden');
  });
});
