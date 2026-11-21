/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { openDrawer, replaceDrawer, getInteractionById } = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  replaceDrawer: vi.fn(),
  getInteractionById: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer, replaceDrawer }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, opts: any) => opts?.defaultValue ?? _key }) }));
vi.mock('@alga-psa/opportunities/actions', () => ({ getOpportunity: vi.fn(async () => ({ opportunity_id: 'opp-1' })) }));
vi.mock('@alga-psa/opportunities/components', () => ({
  OpportunityDetailHost: ({ onOpenInteraction: open }: any) => (
    <button onClick={() => open('interaction-1')}>Open citation</button>
  ),
}));
vi.mock('@alga-psa/clients/actions/interactionActions', () => ({ getInteractionById }));
vi.mock('@alga-psa/clients/components/interactions/InteractionDetails', () => ({ default: ({ interaction }: any) => <div>Details: {interaction.name}</div> }));

import { useOpportunityDetailsDrawer } from './useOpportunityDetailsDrawer';

function DrawerProbe() {
  const openOpportunity = useOpportunityDetailsDrawer();
  return <button onClick={() => void openOpportunity('opp-1')}>Open opportunity</button>;
}

describe('useOpportunityDetailsDrawer interaction citations', () => {
  it('fetches the cited interaction and opens its details', async () => {
    getInteractionById.mockResolvedValue({ interaction_id: 'interaction-1', name: 'Discovery call' });
    render(<DrawerProbe />);

    fireEvent.click(screen.getByText('Open opportunity'));
    await waitFor(() => expect(replaceDrawer).toHaveBeenCalled());
    const drawer = replaceDrawer.mock.calls.at(-1)?.[0];
    render(drawer);
    fireEvent.click(screen.getByText('Open citation'));

    await waitFor(() => expect(getInteractionById).toHaveBeenCalledWith('interaction-1'));
    await waitFor(() => expect(openDrawer).toHaveBeenCalled());
    const interactionDrawer = openDrawer.mock.calls.at(-1)?.[0];
    render(interactionDrawer);
    expect(screen.getByText('Details: Discovery call')).toBeInTheDocument();
  });
});
