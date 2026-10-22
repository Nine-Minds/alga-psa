/** @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContactFlagBadges, PocBadge, VipBadge } from './FlagBadges';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    // Simulates a locale where flags.poc is a long phrase and flags.pocShort an abbreviation.
    t: (key: string, options?: { defaultValue?: string }) => (
      ({ 'flags.poc': 'Ansprechpartner', 'flags.pocShort': 'AP', 'flags.pocFull': 'Ansprechpartner' } as Record<string, string>)[key]
      ?? options?.defaultValue ?? key
    ),
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
    expect(screen.getByTestId('poc-badge').textContent).toBe('Ansprechpartner');

    for (const value of [false, null, undefined]) {
      rerender(<PocBadge isPoc={value} />);
      expect(screen.queryByTestId('poc-badge')).toBeNull();
    }
  });
});

describe('ContactFlagBadges', () => {
  it('compact: combined badge text comes from the short key; label names both flags in full', () => {
    render(<ContactFlagBadges compact isVip={true} isPoc={true} />);
    const badge = screen.getByTestId('vip-poc-badge');
    expect(badge.textContent).toBe('VIP·AP');
    expect(badge.textContent).not.toContain('Ansprechpartner');
    expect(badge.getAttribute('aria-label')).toBe('VIP, Ansprechpartner');
    expect(badge.getAttribute('title')).toBe('VIP, Ansprechpartner');
    expect(screen.queryByTestId('vip-badge')).toBeNull();
    expect(screen.queryByTestId('poc-badge')).toBeNull();
  });

  it('compact: a single POC uses the short key with a full label', () => {
    render(<ContactFlagBadges compact isVip={false} isPoc={true} />);
    const badge = screen.getByTestId('poc-badge');
    expect(badge.textContent).toBe('AP');
    expect(badge.getAttribute('aria-label')).toBe('Ansprechpartner');
  });

  it('compact: a single VIP and no flags', () => {
    const { rerender } = render(<ContactFlagBadges compact isVip={true} isPoc={null} />);
    expect(screen.getByTestId('vip-badge').textContent).toBe('VIP');
    expect(screen.queryByTestId('poc-badge')).toBeNull();
    rerender(<ContactFlagBadges compact />);
    expect(screen.queryByTestId('vip-badge')).toBeNull();
    expect(screen.queryByTestId('poc-badge')).toBeNull();
    expect(screen.queryByTestId('vip-poc-badge')).toBeNull();
  });

  it('non-compact keeps the regular full badges', () => {
    render(<ContactFlagBadges isVip={true} isPoc={true} />);
    expect(screen.getByTestId('vip-badge').textContent).toBe('VIP');
    expect(screen.getByTestId('poc-badge').textContent).toBe('Ansprechpartner');
    expect(screen.queryByTestId('vip-poc-badge')).toBeNull();
  });
});
