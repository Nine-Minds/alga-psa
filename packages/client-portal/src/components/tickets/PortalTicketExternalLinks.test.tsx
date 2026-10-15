// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortalTicketExternalLinks } from './PortalTicketExternalLinks';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe('portal external links', () => {
  it('omits the entire section when empty', () => {
    const { container } = render(<PortalTicketExternalLinks links={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows readable read-only links and explains the destination access boundary', () => {
    render(<PortalTicketExternalLinks links={[{ label: 'Vendor · Case 1042', url: 'https://example.com/login' }]} />);
    const link = screen.getByRole('link', { name: 'Open external record: Vendor · Case 1042' });
    expect(link.getAttribute('href')).toBe('https://example.com/login');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/Sharing the link does not grant access/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
