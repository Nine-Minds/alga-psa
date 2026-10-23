/* @vitest-environment jsdom */

/**
 * The Text / Email choice is a stored per-user preference, so it has to survive
 * a page the reader never touches: the saved value drives the shared store, a
 * switch anywhere saves, and the still-loading default never overwrites what
 * localStorage already seeded.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getInboundEmailViewMode,
  setInboundEmailViewMode,
  type InboundEmailViewMode,
} from '@alga-psa/ui/lib/inboundEmailViewMode';

const preference = {
  value: 'text' as InboundEmailViewMode,
  setValue: vi.fn(),
  isLoading: true,
};

vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: () => preference,
}));

import { useInboundEmailViewPreference } from './useInboundEmailViewPreference';

function Host() {
  useInboundEmailViewPreference();
  return <div data-testid="host" />;
}

beforeEach(() => {
  preference.value = 'text';
  preference.isLoading = true;
  preference.setValue = vi.fn();
  setInboundEmailViewMode('text');
});

describe('useInboundEmailViewPreference', () => {
  it('leaves the seeded mode alone while the preference is still loading', async () => {
    setInboundEmailViewMode('email');

    render(<Host />);

    await waitFor(() => expect(getInboundEmailViewMode()).toBe('email'));
    expect(preference.setValue).not.toHaveBeenCalled();
  });

  it('applies the saved preference once it has resolved', async () => {
    preference.isLoading = false;
    preference.value = 'email';

    render(<Host />);

    await waitFor(() => expect(getInboundEmailViewMode()).toBe('email'));
    // The store now matches the stored value, so nothing is written back.
    expect(preference.setValue).not.toHaveBeenCalled();
  });

  it('saves a switch made anywhere on the page', async () => {
    preference.isLoading = false;
    preference.value = 'text';

    render(<Host />);
    await waitFor(() => expect(getInboundEmailViewMode()).toBe('text'));

    setInboundEmailViewMode('email');

    await waitFor(() => expect(preference.setValue).toHaveBeenCalledWith('email'));
  });
});
