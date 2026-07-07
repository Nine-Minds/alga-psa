/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const getTeamsAddonPurchaseAccessMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../actions', () => ({
  getTeamsAddonPurchaseAccess: (...a: unknown[]) => getTeamsAddonPurchaseAccessMock(...a),
}));

import { TeamsPaywallCard } from './TeamsPaywallCard';

describe('TeamsPaywallCard (F064)', () => {
  beforeEach(() => {
    getTeamsAddonPurchaseAccessMock.mockReset();
  });
  afterEach(() => cleanup());

  it('T105: renders included capabilities and a purchase CTA for billing admins', async () => {
    getTeamsAddonPurchaseAccessMock.mockResolvedValue({ canPurchase: true });
    render(<TeamsPaywallCard />);

    expect(document.querySelector('#teams-paywall-card')).toBeInTheDocument();
    // Included capabilities are listed.
    expect(screen.getByText(/Personal tab/i)).toBeInTheDocument();
    expect(screen.getByText(/calendar invites/i)).toBeInTheDocument();
    expect(screen.getByText(/recordings and transcripts/i)).toBeInTheDocument();

    const cta = await screen.findByRole('link', { name: /Purchase Teams add-on/i });
    expect(cta).toHaveAttribute('href', '/msp/account');
    expect(document.querySelector('#teams-paywall-non-billing')).not.toBeInTheDocument();
  });

  it('T105: hides the purchase CTA for non-billing users', async () => {
    getTeamsAddonPurchaseAccessMock.mockResolvedValue({ canPurchase: false });
    render(<TeamsPaywallCard />);

    // Capabilities still render for context.
    expect(screen.getByText(/Personal tab/i)).toBeInTheDocument();
    // The billing-admin CTA is hidden; a billing-admin hint appears instead.
    await waitFor(() => expect(document.querySelector('#teams-paywall-non-billing')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /Purchase Teams add-on/i })).not.toBeInTheDocument();
  });
});
