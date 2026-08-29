// @vitest-environment jsdom
/**
 * Credential audit screen component tests (EE CredentialAuditScreen):
 *  - gating: flag-off renders nothing; tier gate; `credential:audit` forbidden
 *    state (the audit trail is not shown to viewers without the permission).
 *  - data: rows render, empty vs empty-filtered states, keyset "Load more".
 *  - filters: operation/actor/client/date filter changes re-fetch the action
 *    with the right args.
 */

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCredentialsContextMock,
  getCredentialAuditEventsMock,
  getAllClientsMock,
  getAllUsersMock,
  useFeatureFlagMock,
} = vi.hoisted(() => ({
  getCredentialsContextMock: vi.fn(),
  getCredentialAuditEventsMock: vi.fn(),
  getAllClientsMock: vi.fn(),
  getAllUsersMock: vi.fn(),
  useFeatureFlagMock: vi.fn(),
}));

vi.mock('@ee/lib/actions/credentials/credentialActions', () => ({
  getCredentialsContext: getCredentialsContextMock,
}));

vi.mock('@ee/lib/actions/credentials/credentialAuditActions', () => ({
  getCredentialAuditEvents: getCredentialAuditEventsMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: getAllClientsMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: getAllUsersMock,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { entity?: string; count?: number; fields?: string }) => {
    if (key === 'credentials.audit.op.credential_associated') return `Linked it to ${options?.entity ?? ''}`;
    if (key === 'credentials.audit.op.credential_detached') return `Unlinked it from ${options?.entity ?? ''}`;
    if (key === 'credentials.audit.detail.fieldsChanged') return `Changed: ${options?.fields ?? ''}`;
    if (key === 'credentials.audit.detail.grantsAdded') return `Granted access to ${options?.count ?? 0}`;
    if (key === 'credentials.audit.detail.grantsRemoved') return `Removed access from ${options?.count ?? 0}`;
    const friendly: Record<string, string> = {
      'credentials.audit.pageTitle': 'Password audit log',
      'credentials.audit.loading': 'Loading…',
      'credentials.audit.empty': 'No activity yet.',
      'credentials.audit.emptyFiltered': 'No activity matches these filters.',
      'credentials.audit.loadMore': 'Load more',
      'credentials.audit.forbidden': 'You do not have access to the audit log.',
      'credentials.audit.col.when': 'When',
      'credentials.audit.col.who': 'Who',
      'credentials.audit.col.action': 'Action',
      'credentials.audit.col.credential': 'Password',
      'credentials.audit.filter.operation': 'Action',
      'credentials.audit.filter.actor': 'User',
      'credentials.audit.filter.client': 'Client',
      'credentials.audit.filter.dateRange': 'Date range',
      'credentials.audit.filter.allActors': 'All users',
      'credentials.audit.filter.allClients': 'All clients',
      'credentials.audit.filter.fromDate': 'From date',
      'credentials.audit.filter.toDate': 'To date',
      'credentials.audit.clearFilters': 'Clear filters',
      'credentials.audit.deletedCredential': 'Deleted credential',
      'credentials.audit.huduCredential': 'Hudu password',
      'credentials.audit.detail.systemActor': 'System',
      'credentials.audit.detail.unknownActor': 'A removed user',
      'credentials.audit.op.credential_reveal': 'Revealed the password',
      'credentials.audit.op.credential_otp_seed_reveal': 'Revealed the two-factor key',
      'credentials.audit.op.credential_created': 'Created the credential',
      'credentials.audit.op.credential_updated': 'Edited the credential',
      'credentials.audit.op.credential_deleted': 'Deleted the credential',
      'credentials.audit.op.credential_grants_changed': 'Changed who can access it',
    };
    return friendly[key] ?? key;
  };
  return {
    useTranslation: () => ({ t }),
    useFormatters: () => ({
      formatDate: () => 'Aug 28, 2026',
      formatRelativeTime: () => '2 days ago',
    }),
  };
});

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id }: { children: React.ReactNode; id?: string }) => <span id={id}>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id} role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement> & { id?: string }) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}));

vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  StringDateRangePicker: ({ id, value, onChange }: {
    id?: string;
    value: { from: string; to: string };
    onChange: (range: { from: string; to: string }) => void;
  }) => (
    <div id={id}>
      <input
        id={`${id}-from`}
        value={value.from}
        placeholder="From date"
        onChange={(event) => onChange({ ...value, from: event.target.value })}
      />
      <input
        id={`${id}-to`}
        value={value.to}
        placeholder="To date"
        onChange={(event) => onChange({ ...value, to: event.target.value })}
      />
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, clients, selectedClientId, onSelect }: {
    id?: string;
    clients: Array<{ client_id: string; client_name: string }>;
    selectedClientId: string | null;
    onSelect: (id: string | null) => void;
  }) => (
    <select id={id} value={selectedClientId ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
      <option value="" />
      {clients.map((client) => <option key={client.client_id} value={client.client_id}>{client.client_name}</option>)}
    </select>
  ),
}));

import { CredentialAuditScreen } from '@ee/components/credentials/CredentialAuditScreen';

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

function event(overrides: Record<string, unknown> = {}) {
  return {
    auditId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    timestamp: '2026-08-28T10:00:00.000Z',
    operation: 'credential_reveal',
    actor: { userId: 'user-1', name: 'Alice Example' },
    credentialId: '22222222-2222-2222-2222-222222222222',
    credentialName: 'Domain Admin',
    clientId: CLIENT_ID,
    clientName: 'Acme Corp',
    entity: null,
    ...overrides,
  };
}

async function renderScreen() {
  render(<CredentialAuditScreen />);
  await waitFor(() => {
    expect(document.getElementById('credentials-audit-screen')).toBeTruthy();
  });
  // Settle the audit fetch: the loading paragraph covers both the context
  // probe and the events fetch.
  await waitFor(() => {
    expect(document.getElementById('credentials-audit-loading')).toBeNull();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFeatureFlagMock.mockReturnValue({ enabled: true });
  getCredentialsContextMock.mockResolvedValue({
    tierOk: true,
    huduConnected: false,
    state: 'ok',
    flagIrrelevantHere: true,
    canAudit: true,
  });
  getAllClientsMock.mockResolvedValue([{ client_id: CLIENT_ID, client_name: 'Acme Corp' }]);
  getAllUsersMock.mockResolvedValue([{ user_id: 'user-1', username: 'alice', first_name: 'Alice', last_name: 'Example' }]);
});

afterEach(() => {
  cleanup();
});

describe('CredentialAuditScreen — gating', () => {
  it('renders nothing when the release flag is off', () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });
    const { container } = render(<CredentialAuditScreen />);
    expect(container.firstChild).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('shows the forbidden state when the viewer lacks credential:audit', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: true,
      huduConnected: false,
      state: 'ok',
      flagIrrelevantHere: true,
      canAudit: false,
    });
    render(<CredentialAuditScreen />);
    await waitFor(() => {
      expect(document.getElementById('credentials-audit-forbidden')).toBeTruthy();
    });
    expect(document.getElementById('credentials-audit-forbidden')?.textContent).toContain('You do not have access to the audit log.');
    expect(getCredentialAuditEventsMock).not.toHaveBeenCalled();
  });
});

describe('CredentialAuditScreen — data + paging', () => {
  it('renders audit rows for the viewer', async () => {
    getCredentialAuditEventsMock.mockResolvedValue({
      events: [event(), event({ auditId: 'b', operation: 'credential_updated', actor: { userId: null, name: null } })],
      nextCursor: null,
    });
    await renderScreen();
    expect(document.body.textContent).toContain('Revealed the password');
    expect(document.body.textContent).toContain('Alice Example');
    expect(document.body.textContent).toContain('Domain Admin');
    expect(document.body.textContent).toContain('System');
  });

  it('renders the empty state without filters and the filtered-empty state with them', async () => {
    getCredentialAuditEventsMock.mockResolvedValue({ events: [], nextCursor: null });
    await renderScreen();
    expect(document.getElementById('credentials-audit-empty')?.textContent).toContain('No activity yet.');

    fireEvent.click(document.getElementById('credentials-audit-operation-credential_reveal')!);
    await waitFor(() => {
      expect(document.getElementById('credentials-audit-empty')?.textContent).toContain('No activity matches these filters.');
    });
  });

  it('loads the next page through the keyset cursor', async () => {
    getCredentialAuditEventsMock
      .mockResolvedValueOnce({
        events: [event()],
        nextCursor: { timestamp: '2026-08-28T10:00:00.000Z', auditId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      })
      .mockResolvedValueOnce({
        events: [event({ auditId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', operation: 'credential_deleted' })],
        nextCursor: null,
      });
    await renderScreen();
    expect(document.body.textContent).toContain('Revealed the password');
    fireEvent.click(document.getElementById('credentials-audit-load-more')!);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Deleted the credential');
    });
    expect(getCredentialAuditEventsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { timestamp: '2026-08-28T10:00:00.000Z', auditId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } })
    );
  });

  it('re-fetches with the selected operation filter', async () => {
    getCredentialAuditEventsMock.mockResolvedValue({ events: [event()], nextCursor: null });
    await renderScreen();
    fireEvent.click(document.getElementById('credentials-audit-operation-credential_created')!);
    await waitFor(() => {
      expect(getCredentialAuditEventsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ operations: ['credential_created'] })
      );
    });
  });

  it('re-fetches with actor and date-range filters', async () => {
    getCredentialAuditEventsMock.mockResolvedValue({ events: [], nextCursor: null });
    await renderScreen();

    fireEvent.change(document.getElementById('credentials-audit-actor-filter')!, { target: { value: 'user-1' } });
    await waitFor(() => {
      expect(getCredentialAuditEventsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ actorUserId: 'user-1' })
      );
    });

    fireEvent.change(document.getElementById('credentials-audit-date-range-from')!, { target: { value: '2026-08-01' } });
    await waitFor(() => {
      expect(getCredentialAuditEventsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: '2026-08-01T00:00:00.000Z' })
      );
    });
  });
});
