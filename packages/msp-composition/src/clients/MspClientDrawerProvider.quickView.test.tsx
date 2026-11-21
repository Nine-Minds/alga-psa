// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  replaceDrawer: vi.fn(),
  loadClient: vi.fn(),
}));

vi.mock('@alga-psa/ui', async () => {
  const ReactModule = await import('react');
  const clientDrawerContext = ReactModule.createContext(undefined);
  return {
    useDrawer: () => ({ openDrawer: state.openDrawer, replaceDrawer: state.replaceDrawer }),
    ClientDrawerContext: clientDrawerContext,
    useClientDrawer: () => ReactModule.useContext(clientDrawerContext),
  };
});
vi.mock('@alga-psa/projects/actions', () => ({
  getProjectClientQuickView: (...args: any[]) => state.loadClient(...args),
  updateProjectClientQuickView: vi.fn(),
}));
vi.mock('@alga-psa/clients/components/clients/ClientQuickView', () => ({
  default: ({ client }: any) => <article aria-label="Full client quick view">{client.client_name} details</article>,
}));
vi.mock('./MspClientCrossFeatureProvider', () => ({ MspClientCrossFeatureProvider: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue ?? _key }),
}));

import { useClientDrawer } from '@alga-psa/ui';
import { MspClientDrawerProvider } from './MspClientDrawerProvider';

afterEach(cleanup);

function OpenProjectClientButtons() {
  const clientDrawer = useClientDrawer();
  return <>
    <button onClick={() => clientDrawer?.openClientDrawer('client-a', { projectId: 'project-a' })}>Open A</button>
    <button onClick={() => clientDrawer?.openClientDrawer('client-b', { projectId: 'project-b' })}>Open B</button>
  </>;
}

describe('MspClientDrawerProvider project quick view', () => {
  beforeEach(() => {
    state.openDrawer.mockClear();
    state.replaceDrawer.mockClear();
    state.loadClient.mockReset();
  });

  it('uses project-authorized details to render the established client quick view', async () => {
    state.loadClient.mockResolvedValue({ client_id: 'client-a', client_name: 'Acme' });
    render(<MspClientDrawerProvider><OpenProjectClientButtons /></MspClientDrawerProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
    await waitFor(() => expect(state.loadClient).toHaveBeenCalledWith('client-a', 'project-a'));

    render(state.replaceDrawer.mock.calls[0][0]);
    expect(screen.getByRole('article', { name: 'Full client quick view' }).textContent).toContain('Acme details');
  });

  it('shows permission denial and does not leave previous client details in the drawer', async () => {
    state.loadClient.mockRejectedValue(new Error('Permission denied: Cannot read clients'));
    render(<MspClientDrawerProvider><OpenProjectClientButtons /></MspClientDrawerProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
    await waitFor(() => expect(state.replaceDrawer).toHaveBeenCalledTimes(1));
    render(state.replaceDrawer.mock.calls[0][0]);
    expect(screen.getByRole('alert').textContent).toContain('You do not have permission to view this client.');
  });

  it('ignores a stale detail response after another client is selected', async () => {
    const pending: Array<(client: { client_id: string; client_name: string }) => void> = [];
    state.loadClient.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    render(<MspClientDrawerProvider><OpenProjectClientButtons /></MspClientDrawerProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open B' }));
    await waitFor(() => expect(state.loadClient).toHaveBeenCalledTimes(2));

    await act(async () => pending[1]({ client_id: 'client-b', client_name: 'Client B' }));
    await waitFor(() => expect(state.replaceDrawer).toHaveBeenCalledTimes(1));
    await act(async () => pending[0]({ client_id: 'client-a', client_name: 'Client A' }));

    expect(state.replaceDrawer).toHaveBeenCalledTimes(1);
    render(state.replaceDrawer.mock.calls[0][0]);
    expect(screen.getByRole('article', { name: 'Full client quick view' }).textContent).toContain('Client B details');
    expect(screen.queryByText('Client A details')).toBeNull();
  });
});
