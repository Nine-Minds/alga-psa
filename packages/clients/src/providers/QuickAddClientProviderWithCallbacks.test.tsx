/* @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { QuickAddClientProviderWithCallbacks } from './QuickAddClientProviderWithCallbacks';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  getInteractionById: vi.fn(),
  handleError: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: hoisted.openDrawer }),
}));

vi.mock('../actions/queryActions', () => ({
  getInteractionById: hoisted.getInteractionById,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: hoisted.handleError,
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('../components/clients/QuickAddClient', () => ({ default: () => null }));
vi.mock('../components/contacts/QuickAddContact', () => ({ default: () => null }));
vi.mock('../components/interactions/QuickAddInteraction', () => ({ QuickAddInteraction: () => null }));
vi.mock('../components/interactions/InteractionDetails', () => ({
  default: ({ interaction }: { interaction: { title: string } }) => (
    <div>Drawer: {interaction.title}</div>
  ),
}));

function Probe({ onChanged }: { onChanged: () => void }) {
  const { openInteractionDetails } = useQuickAddClient();
  return (
    <button
      id="open-interaction"
      type="button"
      onClick={() => void openInteractionDetails('interaction-1', onChanged)}
    >
      Open interaction
    </button>
  );
}

describe('QuickAddClientProvider interaction drawer seam', () => {
  it('loads the full interaction and opens InteractionDetails in the global drawer', async () => {
    const onChanged = vi.fn();
    hoisted.openDrawer.mockReset();
    hoisted.getInteractionById.mockReset();
    hoisted.getInteractionById.mockResolvedValue({
      interaction_id: 'interaction-1',
      title: 'Discussed the outage',
    });

    render(
      <QuickAddClientProviderWithCallbacks>
        <Probe onChanged={onChanged} />
      </QuickAddClientProviderWithCallbacks>,
    );
    fireEvent.click(screen.getByText('Open interaction'));

    await waitFor(() => expect(hoisted.openDrawer).toHaveBeenCalledTimes(1));
    expect(hoisted.getInteractionById).toHaveBeenCalledWith('interaction-1');

    const drawerElement = hoisted.openDrawer.mock.calls[0][0] as React.ReactElement<{
      onInteractionDeleted?: () => void;
      onInteractionUpdated?: () => void;
    }>;
    render(drawerElement);
    expect(screen.getByText('Drawer: Discussed the outage')).toBeTruthy();

    drawerElement.props.onInteractionUpdated?.();
    drawerElement.props.onInteractionDeleted?.();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});
