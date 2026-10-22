/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PocBadge, VipBadge } from './FlagBadges';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('VipBadge', () => {
  it('renders only when the flag is true', () => {
    const { rerender } = render(<VipBadge isVip={true} />);
    expect(screen.getByTestId('vip-badge').textContent).toBe('VIP');

    for (const value of [false, null, undefined]) {
      rerender(<VipBadge isVip={value} />);
      expect(screen.queryByTestId('vip-badge')).toBeNull();
    }
  });
});

describe('PocBadge', () => {
  it('renders only when the flag is true', () => {
    const { rerender } = render(<PocBadge isPoc={true} />);
    expect(screen.getByTestId('poc-badge').textContent).toBe('POC');

    for (const value of [false, null, undefined]) {
      rerender(<PocBadge isPoc={value} />);
      expect(screen.queryByTestId('poc-badge')).toBeNull();
    }
  });
});
