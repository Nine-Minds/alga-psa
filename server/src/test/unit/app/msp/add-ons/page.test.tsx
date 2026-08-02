/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const accountManagementMock = vi.hoisted(() => vi.fn());

vi.mock('@/empty/components/settings/account/AccountManagement', () => ({
  default: (props: { selectedAddOn?: string }) => {
    accountManagementMock(props);
    return null;
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn().mockResolvedValue({
    t: (key: string) => (key === 'addOns.title' ? 'Add-ons' : key),
  }),
}));

import AddOnsPage from '@/app/msp/add-ons/page';

afterEach(() => {
  cleanup();
  accountManagementMock.mockClear();
});

describe('/msp/add-ons', () => {
  it('selects the Teams add-on from the canonical query parameter', async () => {
    render(await AddOnsPage({ searchParams: Promise.resolve({ addon: 'teams' }) }));

    expect(accountManagementMock).toHaveBeenCalledWith({
      selectedAddOn: 'teams',
    });
  });

  it.each([
    ['an unknown key', 'not-an-addon'],
    ['a repeated query parameter', ['teams', 'ai_assistant']],
  ])('falls back to the normal account view for %s', async (_label, addon) => {
    render(await AddOnsPage({ searchParams: Promise.resolve({ addon }) }));

    expect(accountManagementMock).toHaveBeenCalledWith({
      selectedAddOn: undefined,
    });
  });
});
