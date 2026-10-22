/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../public/locales/en/msp/service-requests.json';

(globalThis as unknown as { React?: typeof React }).React = React;

const updateMock = vi.fn();
const searchMock = vi.fn();
const groupsMock = vi.fn();

const lookup = (key: string): string | undefined =>
  key.split('.').reduce<any>((node, part) => (node == null ? node : node[part]), en as any);

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const template = lookup(key) ?? (options.defaultValue as string) ?? key;
      return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => String(options[name] ?? ''));
    },
  }),
}));

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../../../../../app/msp/service-requests/actions', () => ({
  updateServiceRequestAudienceAction: (...args: unknown[]) => updateMock(...args),
}));

vi.mock('@alga-psa/clients/actions/clientPickerActions', () => ({
  searchClientsForPicker: (...args: unknown[]) => searchMock(...args),
}));

vi.mock('@alga-psa/client-portal/actions/client-portal-actions/visibilityGroupActions', () => ({
  getClientPortalVisibilityGroups: (...args: unknown[]) => groupsMock(...args),
}));

vi.mock('@alga-psa/ui/components/ClientAvatar', () => ({ default: () => null }));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ onSelect }: { onSelect: (id: string | null) => void }) => (
    <div>
      <button type="button" onClick={() => onSelect('client-a')}>pick-a</button>
      <button type="button" onClick={() => onSelect('client-b')}>pick-b</button>
    </div>
  ),
}));

import { ServiceRequestAudienceEditor } from '../../../../../app/msp/service-requests/ServiceRequestAudienceEditor';

const clients = [
  { client_id: 'client-a', client_name: 'Acme', logoUrl: null },
  { client_id: 'client-b', client_name: 'Globex', logoUrl: null },
];

describe('ServiceRequestAudienceEditor', () => {
  beforeEach(() => {
    updateMock.mockReset().mockResolvedValue({ success: true });
    searchMock.mockReset().mockImplementation(async ({ ids }: { ids?: string[] }) => ({
      clients: clients.filter((c) => !ids || ids.includes(c.client_id)),
    }));
    groupsMock.mockReset().mockImplementation(async (_user: unknown, clientId: string) =>
      clientId === 'client-a'
        ? [{ group_id: 'group-a1', name: 'Finance' }, { group_id: 'group-a2', name: 'Ops' }]
        : []
    );
  });

  afterEach(() => cleanup());

  const everyone = { mode: 'all' as const, clientIds: [], groupIds: [] };

  it('defaults to Everyone and hides the client picker', () => {
    render(<ServiceRequestAudienceEditor definitionId="def-1" initialAudience={everyone} />);
    expect(screen.queryByText('pick-a')).not.toBeInTheDocument();
    expect(screen.getByLabelText(en.editor.execution.visibility.audience.everyone)).toBeChecked();
  });

  it('saves everyone with empty selections', async () => {
    render(<ServiceRequestAudienceEditor definitionId="def-1" initialAudience={everyone} />);
    fireEvent.click(screen.getByText(en.editor.execution.visibility.audience.save));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('def-1', { mode: 'all', clientIds: [], groupIds: [] })
    );
  });

  it('adds clients as all-users, switches one to only-groups and sends no client id for it', async () => {
    const onChange = vi.fn();
    render(<ServiceRequestAudienceEditor definitionId="def-1" initialAudience={everyone} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(en.editor.execution.visibility.audience.scoped));
    expect(screen.getByText(en.editor.execution.visibility.audience.emptyWarning)).toBeInTheDocument();

    fireEvent.click(screen.getByText('pick-a'));
    fireEvent.click(screen.getByText('pick-b'));

    // New clients default to all users.
    fireEvent.click(screen.getByText(en.editor.execution.visibility.audience.save));
    await waitFor(() =>
      expect(updateMock).toHaveBeenLastCalledWith('def-1', {
        mode: 'scoped',
        clientIds: ['client-a', 'client-b'],
        groupIds: [],
      })
    );

    // Client A has groups: switch it to only-groups and tick Finance.
    const onlyGroups = await screen.findByLabelText(en.editor.execution.visibility.audience.onlyGroups);
    fireEvent.click(onlyGroups);
    fireEvent.click(await screen.findByLabelText('Finance', { exact: false }));
    fireEvent.click(screen.getByText(en.editor.execution.visibility.audience.save));
    await waitFor(() =>
      expect(updateMock).toHaveBeenLastCalledWith('def-1', {
        mode: 'scoped',
        clientIds: ['client-b'],
        groupIds: ['group-a1'],
      })
    );
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'scoped', clientIds: ['client-b'], groupIds: ['group-a1'] });

    // Client B has no groups: only all-users is offered.
    expect(screen.getAllByLabelText(en.editor.execution.visibility.audience.onlyGroups)).toHaveLength(1);

    // Removing a client removes its groups too.
    fireEvent.click(document.getElementById('service-request-audience-remove-client-client-a')!);
    fireEvent.click(screen.getByText(en.editor.execution.visibility.audience.save));
    await waitFor(() =>
      expect(updateMock).toHaveBeenLastCalledWith('def-1', {
        mode: 'scoped',
        clientIds: ['client-b'],
        groupIds: [],
      })
    );
  });

  it('reconstructs a group-only client row from saved groups and keeps it out of clientIds', async () => {
    render(
      <ServiceRequestAudienceEditor
        definitionId="def-1"
        initialAudience={{
          mode: 'scoped',
          clientIds: [],
          groupIds: ['group-a2'],
          groupClientIds: { 'group-a2': 'client-a' },
        }}
      />
    );
    expect(await screen.findByLabelText('Ops', { exact: false })).toBeChecked();
    fireEvent.click(screen.getByText(en.editor.execution.visibility.audience.save));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('def-1', { mode: 'scoped', clientIds: [], groupIds: ['group-a2'] })
    );
  });

  it('switching a group-only client back to all users drops its groups', async () => {
    render(
      <ServiceRequestAudienceEditor
        definitionId="def-1"
        initialAudience={{
          mode: 'scoped',
          clientIds: [],
          groupIds: ['group-a2'],
          groupClientIds: { 'group-a2': 'client-a' },
        }}
      />
    );
    await screen.findByLabelText('Ops', { exact: false });
    fireEvent.click(screen.getByLabelText('All users of Acme'));
    fireEvent.click(screen.getByText(en.editor.execution.visibility.audience.save));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('def-1', { mode: 'scoped', clientIds: ['client-a'], groupIds: [] })
    );
  });

  it('does not add the same client twice', async () => {
    render(
      <ServiceRequestAudienceEditor
        definitionId="def-1"
        initialAudience={{ mode: 'scoped', clientIds: ['client-a'], groupIds: [] }}
      />
    );
    fireEvent.click(screen.getByText('pick-a'));
    fireEvent.click(screen.getByText(en.editor.execution.visibility.audience.save));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('def-1', { mode: 'scoped', clientIds: ['client-a'], groupIds: [] })
    );
  });
});
