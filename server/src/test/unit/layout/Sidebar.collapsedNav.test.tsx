// @vitest-environment jsdom
import fs from 'fs';
import path from 'path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({
  pathname: '/msp/dashboard',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _prefetch, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: any) => <img src={typeof src === 'string' ? src : ''} alt={alt} {...rest} />,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: any) => options?.defaultValue ?? key }),
}));
vi.mock('@alga-psa/core', () => ({ getAppVersion: () => '1.0.0' }));
vi.mock('@alga-psa/ui/components/CollapseToggleButton', () => ({
  CollapseToggleButton: (props: any) => <button type="button" id={props.id} onClick={props.onClick} />,
}));
vi.mock('@alga-psa/ui/components/extensions/DynamicNavigationSlot', () => ({
  DynamicNavigationSlot: () => null,
}));
vi.mock('@alga-psa/ui/hooks/useSurfaceIsLight', () => ({ useSurfaceIsLight: () => false }));
vi.mock('@alga-psa/user-composition/hooks', () => ({ useUserPreference: () => ({ value: null }) }));
vi.mock('@/components/layout/MspBrandingContext', () => ({ useMspBranding: () => ({}) }));
vi.mock('@/components/layout/GitHubStarButton', () => ({ default: () => null }));
vi.mock('@/components/search/SearchPalette', () => ({
  default: () => <div data-testid="search-palette" />,
}));

import Sidebar from '@/components/layout/Sidebar';

const ACTIVE_CLASS_HINT = 'color-primary-500';

const renderSidebar = (props: Partial<React.ComponentProps<typeof Sidebar>> = {}) =>
  render(<Sidebar sidebarOpen={false} setSidebarOpen={vi.fn()} {...props} />);

const sectionRow = (id: string) => {
  const row = document.querySelector(`[data-automation-id="sidebar-menu-${id}"]`);
  if (!row) {
    throw new Error(`missing sidebar row ${id}`);
  }
  return row as HTMLElement;
};

beforeEach(() => {
  state.pathname = '/msp/dashboard';
});
afterEach(cleanup);

describe('collapsed rail sub-items', () => {
  it('shows no sub-item labels until the section is opened', () => {
    renderSidebar();

    expect(screen.queryByText('Recurring Tickets')).toBeNull();
  });

  it('opens a flyout with full-text sub-item labels when the section icon is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(within(sectionRow('menu-tickets')).getByRole('button'));

    const flyout = await screen.findByLabelText('Tickets');
    expect(within(flyout).getByText('All Tickets')).toBeTruthy();
    expect(within(flyout).getByText('Recurring Tickets')).toBeTruthy();
    expect(within(flyout).getByText('Ticket Templates')).toBeTruthy();
    expect(within(flyout).getByText('Canned Responses')).toBeTruthy();
    // Each label is a real link, so the flyout is the way to the page too.
    expect(within(flyout).getByText('Recurring Tickets').closest('a')?.getAttribute('href'))
      .toBe('/msp/tickets/recurring');
  });

  it('labels the collapsed Settings sub-items the same way', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(within(sectionRow('bottom-menu-settings')).getByRole('button'));

    const flyout = await screen.findByLabelText('Settings');
    expect(within(flyout).getByText('General')).toBeTruthy();
    expect(within(flyout).getByText('Profile')).toBeTruthy();
    expect(within(flyout).getByText('Security')).toBeTruthy();
  });

  it('keeps the section row highlighted while one of its sub-pages is open', () => {
    state.pathname = '/msp/tickets/recurring';
    renderSidebar();

    expect(sectionRow('menu-tickets').className).toContain(ACTIVE_CLASS_HINT);
  });

  it('hands focus back to the section row when the flyout is dismissed', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const trigger = within(sectionRow('menu-tickets')).getByRole('button');
    await user.click(trigger);

    const flyout = await screen.findByLabelText('Tickets');
    expect(flyout.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');

    // Dropping focus on <body> would restart the next Tab at the top of the page.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('collapsed active highlight', () => {
  const iconClass = (row: HTMLElement) => row.querySelector('svg')?.getAttribute('class') ?? '';

  it('wraps the whole icon in a centred pill instead of stopping at its edge', () => {
    renderSidebar();

    const row = sectionRow('menu-home');
    expect(row.className).toContain(ACTIVE_CLASS_HINT);
    // 40x40 centred, matching the collapsed search button directly above it.
    expect(row.className).toContain('h-10');
    expect(row.className).toContain('w-10');
    expect(row.className).toContain('mx-auto');
    expect(row.className).toContain('justify-center');
    // The label's right margin is what pushed the glyph off-centre in the tint.
    expect(iconClass(row)).not.toContain('mr-2');
  });

  it('shapes a section row the same way as a leaf row', () => {
    state.pathname = '/msp/tickets/recurring';
    renderSidebar();

    const row = sectionRow('menu-tickets');
    expect(row.className).toContain(ACTIVE_CLASS_HINT);
    expect(row.className).toContain('w-10');
    expect(row.className).toContain('justify-center');
    expect(iconClass(row)).not.toContain('mr-2');
  });

  it('keeps the labelled row geometry when the rail is expanded', () => {
    renderSidebar({ sidebarOpen: true });

    const row = sectionRow('menu-home');
    expect(row.className).toContain('px-2');
    expect(row.className).not.toContain('w-10');
    expect(iconClass(row)).toContain('mr-2');
  });
});

describe('expanded section separators', () => {
  const openSection = (id: string) => within(sectionRow(id)).getAllByRole('button')[0];
  const openGroup = (id: string) => document.querySelector(`[data-automation-id="sidebar-section-open-${id}"]`);

  it('brackets an open section with the rail hairline above and below', async () => {
    const user = userEvent.setup();
    renderSidebar({ sidebarOpen: true });

    expect(openGroup('menu-tickets')).toBeNull();

    await user.click(openSection('menu-tickets'));

    expect(openGroup('menu-tickets')?.className).toContain('border-y');
    expect(openGroup('menu-tickets')?.className).toContain('border-sidebar-text/20');
  });

  it('marks the bottom Settings section the same way', async () => {
    const user = userEvent.setup();
    renderSidebar({ sidebarOpen: true });

    await user.click(openSection('bottom-menu-settings'));

    expect(openGroup('bottom-menu-settings')?.className).toContain('border-y');
  });
});

describe('Settings highlight across the settings subtree', () => {
  it('highlights Settings on a settings page that is not one of the quick links', () => {
    state.pathname = '/msp/settings/users';
    renderSidebar({ sidebarOpen: true });

    expect(sectionRow('bottom-menu-settings').className).toContain(ACTIVE_CLASS_HINT);
  });

  it('highlights Settings on the license page reached from the settings nav', () => {
    state.pathname = '/msp/licenses';
    renderSidebar({ sidebarOpen: true });

    expect(sectionRow('bottom-menu-settings').className).toContain(ACTIVE_CLASS_HINT);
  });

  it('leaves Settings unhighlighted elsewhere', () => {
    state.pathname = '/msp/clients';
    renderSidebar({ sidebarOpen: true });

    expect(sectionRow('bottom-menu-settings').className).not.toContain(ACTIVE_CLASS_HINT);
  });
});

describe('swapped nav orientation', () => {
  it('names the mode above the back button, with search above both', () => {
    state.pathname = '/msp/settings/users';
    renderSidebar({ sidebarOpen: true, mode: 'settings' });

    const title = document.querySelector('[data-automation-id="sidebar-mode-title"]');
    expect(title?.textContent).toBe('Settings');

    const search = screen.getByTestId('search-palette');
    const backButton = document.getElementById('settings-back-to-main-button');
    expect(backButton).toBeTruthy();
    // Document order: search, then the mode title, then Back.
    expect(search.compareDocumentPosition(title as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((title as Node).compareDocumentPosition(backButton as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the other swapped modes too', () => {
    state.pathname = '/msp/billing';
    renderSidebar({ sidebarOpen: true, mode: 'billing' });

    expect(document.querySelector('[data-automation-id="sidebar-mode-title"]')?.textContent).toBe('Billing');
  });
});

describe('one rail palette, collapsed or expanded', () => {
  const read = (relativePath: string) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  const searchPalette = read('../../../components/search/SearchPalette.tsx');
  const sidebar = read('../../../components/layout/Sidebar.tsx');

  it('paints the collapsed button and the expanded input from the same sidebar tokens', () => {
    expect(searchPalette.match(/border-sidebar-text\/20 bg-sidebar-text\/5/g)).toHaveLength(2);
    // The fixed greys are what made the collapsed rail look like another app.
    expect(searchPalette).not.toContain('border-gray-500/70');
    expect(searchPalette).not.toContain('text-gray-300');
  });

  it('hovers the rail with a surface-relative tint rather than white', () => {
    expect(sidebar).not.toContain('hover:bg-white/10');
  });
});
