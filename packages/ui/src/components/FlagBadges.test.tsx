/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContactFlagBadges, PocBadge, VipBadge } from './FlagBadges';

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

describe('ContactFlagBadges', () => {
  it('renders one combined badge naming both flags when both are true', () => {
    render(<ContactFlagBadges isVip={true} isPoc={true} />);
    const badge = screen.getByTestId('vip-poc-badge');
    expect(badge.textContent).toBe('VIP·POC');
    expect(badge.getAttribute('aria-label')).toBe('VIP, Point of contact');
    expect(badge.getAttribute('title')).toBe('VIP, Point of contact');
    expect(screen.queryByTestId('vip-badge')).toBeNull();
    expect(screen.queryByTestId('poc-badge')).toBeNull();
  });

  it('falls back to the regular single badges and renders nothing with no flags', () => {
    const { rerender } = render(<ContactFlagBadges isVip={true} isPoc={false} />);
    expect(screen.getByTestId('vip-badge')).toBeTruthy();
    expect(screen.queryByTestId('poc-badge')).toBeNull();
    rerender(<ContactFlagBadges isVip={null} isPoc={true} />);
    expect(screen.getByTestId('poc-badge')).toBeTruthy();
    expect(screen.queryByTestId('vip-badge')).toBeNull();
    rerender(<ContactFlagBadges />);
    expect(screen.queryByTestId('vip-poc-badge')).toBeNull();
    expect(screen.queryByTestId('vip-badge')).toBeNull();
    expect(screen.queryByTestId('poc-badge')).toBeNull();
  });
});
