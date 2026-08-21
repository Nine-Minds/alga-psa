// @vitest-environment jsdom
/**
 * Credentials vault component tests (EE CredentialsScreen + TotpCountdown):
 *  - reveal-state lifecycle: value absent before reveal, present only in
 *    transient state after reveal, cleared on Hide/Refresh, never logged.
 *  - TOTP countdown re-requests a fresh code when the window expires.
 *  - destination picker visibility rules in the create dialog.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCredentialsContextMock,
  listCredentialsMock,
  revealCredentialMock,
  createCredentialMock,
  updateCredentialMock,
  deleteCredentialMock,
  getAllClientsMock,
  getHuduClientContextMock,
  useFeatureFlagMock,
  hasTierFeatureMock,
  addCredentialToEntityMock,
  removeCredentialFromEntityMock,
  setEntityCredentialsMock,
  clipboardWriteMock,
} = vi.hoisted(() => ({
  getCredentialsContextMock: vi.fn(),
  listCredentialsMock: vi.fn(),
  revealCredentialMock: vi.fn(),
  createCredentialMock: vi.fn(),
  updateCredentialMock: vi.fn(),
  deleteCredentialMock: vi.fn(),
  getAllClientsMock: vi.fn(),
  getHuduClientContextMock: vi.fn(),
  useFeatureFlagMock: vi.fn(),
  hasTierFeatureMock: vi.fn(),
  addCredentialToEntityMock: vi.fn(),
  removeCredentialFromEntityMock: vi.fn(),
  setEntityCredentialsMock: vi.fn(),
  clipboardWriteMock: vi.fn(),
}));

vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasFeature: hasTierFeatureMock }),
}));

vi.mock('@ee/lib/actions/credentials/credentialActions', () => ({
  getCredentialsContext: getCredentialsContextMock,
  listCredentials: listCredentialsMock,
  revealCredential: revealCredentialMock,
  createCredential: createCredentialMock,
  updateCredential: updateCredentialMock,
  deleteCredential: deleteCredentialMock,
  setCredentialRestriction: vi.fn(),
  addCredentialToEntity: addCredentialToEntityMock,
  removeCredentialFromEntity: removeCredentialFromEntityMock,
  setEntityCredentials: setEntityCredentialsMock,
}));

vi.mock('@enterprise/lib/actions/integrations/huduDataActions', () => ({
  getHuduClientContext: getHuduClientContextMock,
}));

// The surface wrappers dynamic-import the section through the `@enterprise`
// alias, which in the ee/server test env resolves to the CE stub (render
// null). Mock it to a recognizable stub so the flag-on wrapper path can be
// asserted without pulling the real EE component through next/dynamic.
vi.mock('@enterprise/components/credentials/EntityCredentialsSection', () => ({
  EntityCredentialsSection: ({ entityType, entityId }: { entityType: string; entityId: string }) => (
    <div id={`ee-entity-section-${entityType}`}>{entityId}</div>
  ),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: getAllClientsMock,
}));

vi.mock('@alga-psa/assets/actions', () => ({
  listAssets: vi.fn(async () => ({ assets: [], total: 0 })),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: vi.fn(async () => []),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn(async () => []),
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  default: ({ placeholder }: { placeholder?: string }) => <div>{placeholder}</div>,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; seconds?: number }) => {
    if (options?.defaultValue) return options.defaultValue;
    const friendly: Record<string, string> = {
      'credentials.table.revealNoAccess': 'you do not have permission to reveal this password',
      'credentials.table.revealNotFound': 'this password no longer exists',
      'credentials.table.revealFailed': 'could not reveal the value',
      'credentials.form.entity.asset': 'Asset',
      'credentials.form.entity.ticket': 'Ticket',
      'credentials.form.entity.contact': 'Contact',
      'credentials.form.entity.document': 'Document',
      'credentials.form.entity.project_task': 'Project task',
    };
    return friendly[key] ?? key;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <span id={id} data-variant={variant}>
      {children}
    </span>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button id={id} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id, variant }: { children: React.ReactNode; id?: string; variant?: string }) => (
    <div id={id} role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement> & { id?: string }) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { id?: string }) => (
    <textarea {...props} />
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    children,
    isOpen,
    title,
    footer,
    onClose,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
    title?: string;
    footer?: React.ReactNode;
    onClose?: () => void;
  }) =>
    isOpen ? (
      <div data-testid="dialog">
        {title ? <h2>{title}</h2> : null}
        <button id="dialog-close-x" onClick={onClose}>X</button>
        <button id="dialog-close-escape" onClick={onClose}>Escape</button>
        <button id="dialog-close-backdrop" onClick={onClose}>Backdrop</button>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    id,
    isOpen,
    onConfirm,
    onClose,
    title,
    message,
    confirmLabel,
  }: {
    id?: string;
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
  }) =>
    isOpen ? (
      <div id={id ?? 'confirmation-dialog'} role="alertdialog">
        <div>{title}</div>
        <div>{message}</div>
        <button id={`${id ?? 'confirmation-dialog'}-confirm`} onClick={() => onConfirm()}>
          {confirmLabel ?? 'Confirm'}
        </button>
        <button id={`${id ?? 'confirmation-dialog'}-cancel`} onClick={onClose}>
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (c: boolean) => void }) => (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
      {label}
    </label>
  ),
}));

// Keep the test surface focused on credential behavior while preserving the
// picker contract (the production implementation is the searchable picker).
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, clients, selectedClientId, onSelect }: { id: string; clients: Array<{ client_id: string; client_name: string }>; selectedClientId: string | null; onSelect: (id: string | null) => void }) => (
    <select id={id} value={selectedClientId ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
      <option value="" />
      {clients.map((client) => <option key={client.client_id} value={client.client_id}>{client.client_name}</option>)}
    </select>
  ),
}));

vi.mock('qrcode/lib/browser', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,local-preview') } }));

import { CredentialsScreen } from '@ee/components/credentials/CredentialsScreen';
import { TotpCountdown } from '@ee/components/credentials/TotpCountdown';
import { AssetCredentialsSection as EeAssetCredentialsSection } from '@ee/components/credentials/AssetCredentialsSection';
import { EntityCredentialsSection as EeEntityCredentialsSection } from '@ee/components/credentials/EntityCredentialsSection';
import { AssetCredentialsSection as AssetsWrapperAssetCredentialsSection } from '@alga-psa/assets/components/tabs/AssetCredentialsSection';
import { TicketCredentialsSection } from '@alga-psa/tickets/components/ticket/TicketCredentialsSection';
import { ContactCredentialsSection } from '@alga-psa/clients/components/contacts/ContactCredentialsSection';
import { DocumentCredentialsSection } from '@alga-psa/documents/components/DocumentCredentialsSection';
import { TaskCredentialsSection } from '@alga-psa/projects/components/TaskCredentialsSection';

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const SECRET_VALUE = 'S3cr3t-V@ult-V4lue';
const SECRET_OTP = 'GEZDGNBVGY3TQOJQ';

function credential(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    source: 'alga',
    clientId: CLIENT_ID,
    clientName: 'Acme Corp',
    name: 'Domain Admin',
    username: 'admin@example.com',
    url: 'https://portal.example.com',
    description: 'Notes',
    hasOtp: false,
    isRestricted: false,
    folderName: null,
    externalUrl: null,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

async function renderScreen(props: {
  clientId?: string;
  entityType?: 'asset' | 'ticket' | 'contact' | 'document' | 'project_task';
  entityId?: string;
  defaultClientId?: string | null;
} = {}) {
  render(<CredentialsScreen {...props} />);
  await waitFor(() => {
    expect(document.getElementById('credentials-screen-list')).toBeTruthy();
  });
}

const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  useFeatureFlagMock.mockReturnValue({ enabled: true });
  hasTierFeatureMock.mockReturnValue(true);
  getCredentialsContextMock.mockResolvedValue({
    tierOk: true,
    huduConnected: false,
    flagIrrelevantHere: true,
  });
  listCredentialsMock.mockResolvedValue([credential()]);
  revealCredentialMock.mockResolvedValue({ state: 'ok', password: SECRET_VALUE, otpCode: null });
  createCredentialMock.mockResolvedValue(credential());
  getAllClientsMock.mockResolvedValue([{ client_id: CLIENT_ID, client_name: 'Acme Corp' }]);
  getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWriteMock.mockResolvedValue(undefined) } });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_VALUE);
    }
    spy.mockRestore();
  }
  consoleSpies.length = 0;
});

describe('CredentialsScreen — reveal-state lifecycle', () => {
  it('renders metadata-only rows with no value anywhere before reveal', async () => {
    await renderScreen();

    expect(document.getElementById('credentials-row-name-22222222-2222-2222-2222-222222222222')?.textContent).toContain('Domain Admin');
    expect(document.body.textContent).not.toContain(SECRET_VALUE);
    expect(revealCredentialMock).not.toHaveBeenCalled();
  });

  it('reveal on click returns a transient value that lives only in component state', async () => {
    await renderScreen();

    fireEvent.click(document.getElementById('credentials-row-reveal-22222222-2222-2222-2222-222222222222')!);

    await waitFor(() => {
      expect(document.getElementById('credentials-row-value-22222222-2222-2222-2222-222222222222')?.textContent).toBe(SECRET_VALUE);
    });
    expect(revealCredentialMock).toHaveBeenCalledTimes(1);
  });

  it('Hide clears the value from the DOM (back to the Reveal affordance)', async () => {
    await renderScreen();
    fireEvent.click(document.getElementById('credentials-row-reveal-22222222-2222-2222-2222-222222222222')!);
    await waitFor(() => {
      expect(document.getElementById('credentials-row-value-22222222-2222-2222-2222-222222222222')).toBeTruthy();
    });

    fireEvent.click(document.getElementById('credentials-row-hide-22222222-2222-2222-2222-222222222222')!);

    await waitFor(() => {
      expect(document.getElementById('credentials-row-value-22222222-2222-2222-2222-222222222222')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(SECRET_VALUE);
  });

  it('Refresh clears every revealed value and re-fetches', async () => {
    await renderScreen();
    fireEvent.click(document.getElementById('credentials-row-reveal-22222222-2222-2222-2222-222222222222')!);
    await waitFor(() => {
      expect(document.getElementById('credentials-row-value-22222222-2222-2222-2222-222222222222')).toBeTruthy();
    });
    const callsBefore = listCredentialsMock.mock.calls.length;

    fireEvent.click(document.getElementById('credentials-screen-refresh')!);

    await waitFor(() => {
      expect(listCredentialsMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    await waitFor(() => {
      expect(document.getElementById('credentials-row-value-22222222-2222-2222-2222-222222222222')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(SECRET_VALUE);
  });

  it('shows an inline error when reveal is denied', async () => {
    revealCredentialMock.mockResolvedValue({ state: 'no_access' });
    await renderScreen();

    fireEvent.click(document.getElementById('credentials-row-reveal-22222222-2222-2222-2222-222222222222')!);

    await waitFor(() => {
      expect(document.getElementById('credentials-row-reveal-error-22222222-2222-2222-2222-222222222222')?.textContent).toContain('permission');
    });
    expect(document.getElementById('credentials-row-value-22222222-2222-2222-2222-222222222222')).toBeNull();
  });
});

describe('CredentialsScreen — filters and flags', () => {
  it('renders nothing when the release flag is off', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(<CredentialsScreen />);

    expect(container.firstChild).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('shows the tier upgrade notice when the tier gate is closed', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: false,
      huduConnected: false,
      state: 'tier',
      flagIrrelevantHere: true,
    });

    render(<CredentialsScreen />);

    await waitFor(() => {
      expect(document.getElementById('credentials-screen-tier')).toBeTruthy();
    });
    expect(listCredentialsMock).not.toHaveBeenCalled();
  });

  it('falls back to the tier upgrade notice for a legacy context without a state', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: false,
      huduConnected: false,
      flagIrrelevantHere: true,
    });

    render(<CredentialsScreen />);

    await waitFor(() => {
      expect(document.getElementById('credentials-screen-tier')).toBeTruthy();
    });
  });

  it('shows the permission message instead of an upsell when credential:read is missing', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: false,
      huduConnected: false,
      state: 'forbidden',
      flagIrrelevantHere: true,
    });

    render(<CredentialsScreen />);

    await waitFor(() => {
      expect(document.getElementById('credentials-screen-forbidden')).toBeTruthy();
    });
    expect(document.getElementById('credentials-screen-tier')).toBeNull();
    expect(listCredentialsMock).not.toHaveBeenCalled();
  });

  it('shows the unavailable alert when the context probe failed', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: false,
      huduConnected: false,
      state: 'unavailable',
      flagIrrelevantHere: true,
    });

    render(<CredentialsScreen />);

    await waitFor(() => {
      expect(document.getElementById('credentials-screen-unavailable')).toBeTruthy();
    });
    expect(document.getElementById('credentials-screen-tier')).toBeNull();
  });

  it('filters rows by source', async () => {
    getCredentialsContextMock.mockResolvedValue({ tierOk: true, huduConnected: true, state: 'ok', flagIrrelevantHere: true });
    listCredentialsMock.mockResolvedValue([
      credential({ id: 'native-1', source: 'alga', name: 'Native' }),
      credential({ id: 'hudu-1', source: 'hudu', name: 'Hudu Row' }),
    ]);
    await renderScreen();

    fireEvent.change(document.getElementById('credentials-screen-source-filter')!, {
      target: { value: 'hudu' },
    });

    await waitFor(() => {
      expect(document.getElementById('credentials-row-name-hudu-1')).toBeTruthy();
      expect(document.getElementById('credentials-row-name-native-1')).toBeNull();
    });
  });
});

describe('CredentialsScreen — create dialog destination picker', () => {
  it('closes an untouched overlay through Cancel, X, Escape, and backdrop without confirmation', async () => {
    for (const closeId of ['credential-form-cancel', 'dialog-close-x', 'dialog-close-escape', 'dialog-close-backdrop']) {
      cleanup();
      await renderScreen();
      fireEvent.click(document.getElementById('credentials-screen-new')!);
      await waitFor(() => expect(document.querySelector('[data-testid="dialog"]')).toBeTruthy());
      fireEvent.click(document.getElementById(closeId)!);
      await waitFor(() => expect(document.querySelector('[data-testid="dialog"]')).toBeNull());
      expect(document.getElementById('credential-form-discard')).toBeNull();
    }
  });

  it('guards dirty overlay close routes, keeps editing, then discards when confirmed', async () => {
    for (const closeId of ['credential-form-cancel', 'dialog-close-x', 'dialog-close-escape', 'dialog-close-backdrop']) {
      cleanup();
      await renderScreen();
      fireEvent.click(document.getElementById('credentials-screen-new')!);
      await waitFor(() => expect(document.getElementById('credential-form-name')).toBeTruthy());
      fireEvent.change(document.getElementById('credential-form-name')!, { target: { value: `changed-${closeId}` } });
      fireEvent.click(document.getElementById(closeId)!);
      expect(document.getElementById('credential-form-discard')).toBeTruthy();
      fireEvent.click(document.getElementById('credential-form-discard-cancel')!);
      expect(document.querySelector('[data-testid="dialog"]')).toBeTruthy();
      fireEvent.click(document.getElementById(closeId)!);
      fireEvent.click(document.getElementById('credential-form-discard-confirm')!);
      await waitFor(() => expect(document.querySelector('[data-testid="dialog"]')).toBeNull());
    }
  });

  it('hides Hudu filter and destination when the integration is inactive', async () => {
    await renderScreen();
    expect(document.querySelector('#credentials-screen-source-filter option[value="hudu"]')).toBeNull();
    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => expect(document.getElementById('credential-form-name')).toBeTruthy());
    fireEvent.change(document.getElementById('credential-form-client')!, { target: { value: CLIENT_ID } });
    expect(getHuduClientContextMock).not.toHaveBeenCalled();
    expect(document.getElementById('credential-form-destination-hudu')).toBeNull();
  });

  it('uses the picker globally and locks the client on preselected entity create', async () => {
    await renderScreen();
    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => expect(document.getElementById('credential-form-client')).toBeTruthy());
    cleanup();
    render(<CredentialsScreen entityType="asset" entityId="asset-1" defaultClientId={CLIENT_ID} />);
    await waitFor(() => expect(document.getElementById('credentials-screen-new')).toBeTruthy());
    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => expect(document.getElementById('credential-form-name')).toBeTruthy());
    expect(document.getElementById('credential-form-client')).toBeNull();
  });

  it('only requests discard confirmation after meaningful inline changes, including Back', async () => {
    render(<CredentialsScreen entityType="asset" entityId="asset-1" defaultClientId={CLIENT_ID} />);
    await waitFor(() => expect(document.getElementById('credentials-screen-new')).toBeTruthy());
    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => expect(document.getElementById('credential-form-cancel')).toBeTruthy());
    fireEvent.click(document.getElementById('credential-form-cancel')!);
    expect(document.getElementById('credential-form-discard')).toBeNull();
    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => expect(document.getElementById('credential-form-name')).toBeTruthy());
    fireEvent.change(document.getElementById('credential-form-name')!, { target: { value: 'changed' } });
    fireEvent.click(document.getElementById('credentials-screen-back')!);
    expect(document.getElementById('credential-form-discard')).toBeTruthy();
  });

  it('generates covered character sets, supports reveal/copy, and shows TOTP QR previews', async () => {
    getCredentialsContextMock.mockResolvedValue({ tierOk: true, huduConnected: true, state: 'ok', flagIrrelevantHere: true });
    await renderScreen();
    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => expect(document.getElementById('credential-form-generate')).toBeTruthy());
    fireEvent.click(document.getElementById('credential-form-generate')!);
    const checks = document.querySelectorAll('#credential-form-generator input[type="checkbox"]');
    checks.forEach((check) => fireEvent.click(check));
    expect((document.getElementById('credential-form-generator-apply') as HTMLButtonElement).disabled).toBe(true);
    checks.forEach((check) => fireEvent.click(check));
    fireEvent.click(document.getElementById('credential-form-generator-apply')!);
    const password = (document.getElementById('credential-form-password') as HTMLInputElement).value;
    expect(password).toMatch(/[A-Z]/); expect(password).toMatch(/[a-z]/); expect(password).toMatch(/[0-9]/); expect(password).toMatch(/[!@#$%^&*()_+\-=[\]{};:,.<>?]/);
    expect((document.getElementById('credential-form-password') as HTMLInputElement).type).toBe('text');
    fireEvent.click(document.getElementById('credential-form-password-visibility')!);
    expect((document.getElementById('credential-form-password') as HTMLInputElement).type).toBe('password');
    expect(document.getElementById('credential-form-password-copy')?.getAttribute('aria-label')).toBe('credentials.form.passwordCopy');
    fireEvent.click(document.getElementById('credential-form-password-copy')!);
    await waitFor(() => expect(clipboardWriteMock).toHaveBeenCalledWith(password));
    expect(document.getElementById('credential-form-password-copied')).toBeTruthy();
    fireEvent.change(document.getElementById('credential-form-otp')!, { target: { value: 'GEZDGNBVGY3TQOJQ' } });
    await waitFor(() => expect(document.getElementById('credential-form-otp-qr')).toBeTruthy());
    fireEvent.change(document.getElementById('credential-form-otp')!, { target: { value: 'otpauth://totp/Example?secret=GEZDGNBVGY3TQOJQ&issuer=Example' } });
    await waitFor(() => expect(document.getElementById('credential-form-otp-qr')).toBeTruthy());
    fireEvent.change(document.getElementById('credential-form-otp')!, { target: { value: 'invalid!' } });
    await waitFor(() => expect(document.getElementById('credential-form-otp-qr')).toBeNull());
  });

  it('shows a safe expected save message and falls back for unknown failures', async () => {
    createCredentialMock
      .mockRejectedValueOnce(Object.assign(new Error('HUDU_UNMAPPED'), { code: 'HUDU_UNMAPPED' }))
      .mockRejectedValueOnce(new Error('arbitrary raw failure'));
    await renderScreen();
    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => expect(document.getElementById('credential-form-name')).toBeTruthy());
    fireEvent.change(document.getElementById('credential-form-name')!, { target: { value: 'A' } });
    fireEvent.change(document.getElementById('credential-form-client')!, { target: { value: CLIENT_ID } });
    fireEvent.click(document.getElementById('credential-form-submit')!);
    await waitFor(() => expect(document.getElementById('credential-form-error')?.textContent).toContain('credentials.form.errors.huduUnmapped'));
    fireEvent.click(document.getElementById('credential-form-submit')!);
    await waitFor(() => expect(document.getElementById('credential-form-error')?.textContent).toContain('credentials.form.createFailed'));
  });
  it('shows the destination picker only when the SELECTED CLIENT is mapped to a Hudu company', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: true,
      huduConnected: true,
      flagIrrelevantHere: true,
    });
    // The chosen client resolves as connected AND mapped — the per-client
    // basis for the destination picker (not a global "Hudu connected" check).
    getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: true });
    await renderScreen();

    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => {
      expect(document.getElementById('credential-form-name')).toBeTruthy();
    });

    // No client selected yet → the Alga-only hint, no picker buttons.
    expect(document.getElementById('credential-form-destination-alga')).toBeNull();
    expect(document.getElementById('credential-form-destination-hudu')).toBeNull();
    expect(document.getElementById('credential-form-destination-hint')).toBeTruthy();

    fireEvent.change(document.getElementById('credential-form-client')!, {
      target: { value: CLIENT_ID },
    });

    await waitFor(() => {
      expect(document.getElementById('credential-form-destination-hudu')).toBeTruthy();
    });
    expect(getHuduClientContextMock).toHaveBeenCalledWith(CLIENT_ID);
    expect(document.getElementById('credential-form-destination-alga')).toBeTruthy();
    expect(document.getElementById('credential-form-destination-hint')).toBeNull();
  });

  it('keeps the Alga-only hint when the selected client is NOT mapped, even if Hudu is connected', async () => {
    // Global "Hudu connected" is true, but THIS client is unmapped → no
    // destination picker (destination availability is per-client mapping).
    getCredentialsContextMock.mockResolvedValue({
      tierOk: true,
      huduConnected: true,
      flagIrrelevantHere: true,
    });
    getHuduClientContextMock.mockResolvedValue({ connected: true, mapped: false });
    await renderScreen();

    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => {
      expect(document.getElementById('credential-form-name')).toBeTruthy();
    });

    fireEvent.change(document.getElementById('credential-form-client')!, {
      target: { value: CLIENT_ID },
    });

    await waitFor(() => {
      expect(document.getElementById('credential-form-destination-hint')).toBeTruthy();
    });
    expect(document.getElementById('credential-form-destination-hudu')).toBeNull();
    expect(document.getElementById('credential-form-destination-alga')).toBeNull();
  });

  it('pre-attaches the entity when created from an entity section', async () => {
    getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });
    createCredentialMock.mockResolvedValue({ id: 'new-credential' });
    listCredentialsMock.mockResolvedValue([credential()]);

    render(<CredentialsScreen entityType="asset" entityId="asset-1" defaultClientId={CLIENT_ID} />);
    await waitFor(() => {
      expect(document.getElementById('credentials-screen-new')).toBeTruthy();
    });

    fireEvent.click(document.getElementById('credentials-screen-new')!);
    await waitFor(() => {
      expect(document.getElementById('credential-form-name')).toBeTruthy();
    });

    fireEvent.change(document.getElementById('credential-form-name')!, {
      target: { value: 'Router Admin' },
    });
    fireEvent.click(document.getElementById('credential-form-submit')!);

    await waitFor(() => {
      expect(createCredentialMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: CLIENT_ID,
          name: 'Router Admin',
          attachments: [{ entityType: 'asset', entityId: 'asset-1' }],
        })
      );
    });
  });
});

describe('TotpCountdown — countdown re-request', () => {
  it('renders the code and remaining seconds, then re-requests on expiry', async () => {
    vi.useFakeTimers();
    try {
      revealCredentialMock.mockResolvedValue({
        state: 'ok',
        password: '',
        otpCode: { code: '111111', secondsRemaining: 30 },
      });

      render(
        <TotpCountdown
          credentialId="cred-1"
          initial={{ code: '123456', secondsRemaining: 2 }}
        />
      );

      const countdown = document.getElementById('credentials-totp-countdown');
      expect(countdown?.getAttribute('data-code')).toBe('123456');
      expect(countdown?.getAttribute('data-seconds-remaining')).toBe('2');

      // Advance one second at a time so React state flushes between ticks;
      // at 0 the component re-requests a fresh code from the server.
      for (let tick = 0; tick < 3; tick += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }

      expect(revealCredentialMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const fresh = document.getElementById('credentials-totp-code');
      expect(fresh?.textContent).toBe('111111');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AssetCredentialsSection — flag-off regression (no empty vault card)', () => {
  it('EE section renders nothing when the release flag is off (Card gated, not just the list)', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(
      <EeAssetCredentialsSection assetId="asset-1" clientId={CLIENT_ID} />
    );

    expect(container.firstChild).toBeNull();
    expect(document.getElementById('asset-credentials-section')).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('EE section renders the upgrade teaser (not the vault) below the Pro tier', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true });
    hasTierFeatureMock.mockReturnValue(false);

    render(<EeAssetCredentialsSection assetId="asset-1" clientId={CLIENT_ID} />);

    expect(document.getElementById('asset-credentials-tier-teaser')).toBeTruthy();
    expect(document.getElementById('asset-credentials-view-plans')).toBeTruthy();
    expect(document.getElementById('asset-credentials-section')).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('EE section renders the vault card when the release flag is on', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true });
    getCredentialsContextMock.mockResolvedValue({
      tierOk: true,
      huduConnected: false,
      flagIrrelevantHere: true,
    });
    listCredentialsMock.mockResolvedValue([]);

    render(<EeAssetCredentialsSection assetId="asset-1" clientId={CLIENT_ID} />);

    await waitFor(() => {
      expect(document.getElementById('asset-credentials-section')).toBeTruthy();
    });
  });

  it('shared assets wrapper renders the legacy placeholder (and no vault card) when the flag is off', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(
      <AssetsWrapperAssetCredentialsSection assetId="asset-1" clientId={CLIENT_ID} />
    );

    // Legacy pre-vault placeholder is preserved exactly.
    expect(document.body.textContent).toContain('Passwords & Secrets');
    expect(document.body.textContent).toContain('Secure password management coming soon.');
    // No vault card anywhere.
    expect(document.getElementById('asset-credentials-section')).toBeNull();
    expect(container.querySelector('code')).toBeNull();
  });
});


describe('CredentialsScreen — entity-scoped (association-driven) lists', () => {
  it('scopes listCredentials to the entity (both sources)', async () => {
    listCredentialsMock.mockResolvedValue([credential()]);

    render(<CredentialsScreen entityType="ticket" entityId="ticket-1" defaultClientId={CLIENT_ID} />);
    await waitFor(() => {
      expect(document.getElementById('credentials-screen-list')).toBeTruthy();
    });

    expect(listCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'ticket', entityId: 'ticket-1' })
    );
  });

  it('offers Link existing + detach on entity-scoped rows (no edit/delete/restrict)', async () => {
    listCredentialsMock.mockResolvedValue([credential()]);

    render(<CredentialsScreen entityType="contact" entityId="contact-1" defaultClientId={CLIENT_ID} />);
    await waitFor(() => {
      expect(document.getElementById('credentials-screen-list')).toBeTruthy();
    });

    const id = '22222222-2222-2222-2222-222222222222';
    expect(document.getElementById('credentials-screen-link')).toBeTruthy();
    expect(document.getElementById(`credentials-row-detach-${id}`)).toBeTruthy();
    expect(document.getElementById(`credentials-row-edit-${id}`)).toBeNull();
    expect(document.getElementById(`credentials-row-delete-${id}`)).toBeNull();
    expect(document.getElementById(`credentials-row-restrict-${id}`)).toBeNull();
  });
});

describe('CredentialsScreen — link existing (entity side)', () => {
  it('lists same-client candidates and calls addCredentialToEntity on link', async () => {
    listCredentialsMock.mockImplementation(async (input: Record<string, unknown>) => {
      if (input?.entityType) return [];
      return [credential()];
    });

    render(<CredentialsScreen entityType="ticket" entityId="ticket-1" defaultClientId={CLIENT_ID} />);
    await waitFor(() => {
      expect(document.getElementById('credentials-screen-link')).toBeTruthy();
    });

    fireEvent.click(document.getElementById('credentials-screen-link')!);
    await waitFor(() => {
      expect(document.getElementById('credential-link-name-22222222-2222-2222-2222-222222222222')).toBeTruthy();
    });

    // The picker is filtered to the entity's owning client.
    expect(listCredentialsMock).toHaveBeenLastCalledWith({ clientId: CLIENT_ID });

    fireEvent.click(document.getElementById('credential-link-select-22222222-2222-2222-2222-222222222222')!);

    await waitFor(() => {
      expect(addCredentialToEntityMock).toHaveBeenCalledWith('ticket', 'ticket-1', '22222222-2222-2222-2222-222222222222');
    });
  });

  it('detaches a row via removeCredentialFromEntity', async () => {
    listCredentialsMock.mockResolvedValue([credential()]);

    render(<CredentialsScreen entityType="asset" entityId="asset-1" defaultClientId={CLIENT_ID} />);
    await waitFor(() => {
      expect(document.getElementById('credentials-screen-list')).toBeTruthy();
    });

    fireEvent.click(document.getElementById('credentials-row-detach-22222222-2222-2222-2222-222222222222')!);

    // Detach confirms through the in-app dialog, not window.confirm.
    await waitFor(() => {
      expect(document.getElementById('credentials-confirm-dialog-confirm')).toBeTruthy();
    });
    fireEvent.click(document.getElementById('credentials-confirm-dialog-confirm')!);

    await waitFor(() => {
      expect(removeCredentialFromEntityMock).toHaveBeenCalledWith('asset', 'asset-1', '22222222-2222-2222-2222-222222222222');
    });
  });
});

describe('CredentialFormDialog — read-only associations summary on edit', () => {
  it('shows the attachment summary instead of the asset picker when editing', async () => {
    getHuduClientContextMock.mockResolvedValue({ connected: false, mapped: false });
    listCredentialsMock.mockResolvedValue([credential()]);
    const editing = credential({
      id: 'edit-cred',
      name: 'Edit Me',
      attachments: [
        { entityType: 'ticket', entityId: 'ticket-1' },
        { entityType: 'ticket', entityId: 'ticket-2' },
        { entityType: 'asset', entityId: 'asset-9' },
      ],
    });

    render(
      <CredentialsScreen
        defaultClientId={CLIENT_ID}
      />
    );
    // The global list (no entity scope) shows the edit affordance so the edit
    // dialog can be reached; the summary assertion below drives the dialog
    // directly.
    await waitFor(() => {
      expect(document.getElementById('credentials-screen-list')).toBeTruthy();
    });

    // Show that the edit dialog renders a read-only summary (not a picker)
    // when editing a credential with attachments.
    const { CredentialFormDialog } = await import('@ee/components/credentials/CredentialFormDialog');
    render(
      <CredentialFormDialog
        isOpen
        onClose={() => undefined}
        onSubmit={async () => undefined}
        editing={editing as never}
        defaultClientId={CLIENT_ID}
        context={{ tierOk: true, huduConnected: false, flagIrrelevantHere: true } as never}
      />
    );

    await waitFor(() => {
      expect(document.getElementById('credential-form-associations-summary')?.textContent).toContain('Ticket · 2');
      expect(document.getElementById('credential-form-associations-summary')?.textContent).toContain('Asset');
    });
    // No asset-attach picker anywhere in the edit dialog.
    expect(document.getElementById('credential-form-assets')).toBeNull();
  });
});

describe('EntityCredentialsSection — generic entity section gating', () => {
  it('renders nothing when the release flag is off', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(
      <EeEntityCredentialsSection entityType="ticket" entityId="ticket-1" defaultClientId={CLIENT_ID} />
    );

    expect(container.firstChild).toBeNull();
    expect(document.getElementById('ticket-credentials-section')).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('renders the tier teaser (not the vault) below Pro', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true });
    hasTierFeatureMock.mockReturnValue(false);

    render(<EeEntityCredentialsSection entityType="ticket" entityId="ticket-1" defaultClientId={CLIENT_ID} />);

    expect(document.getElementById('ticket-credentials-tier-teaser')).toBeTruthy();
    expect(document.getElementById('ticket-credentials-view-plans')).toBeTruthy();
    expect(document.getElementById('ticket-credentials-section')).toBeNull();
  });

  it('renders the vault scoped to the entity when the flag is on and tier is met', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true });
    hasTierFeatureMock.mockReturnValue(true);
    getCredentialsContextMock.mockResolvedValue({
      tierOk: true,
      huduConnected: false,
      flagIrrelevantHere: true,
    });
    listCredentialsMock.mockResolvedValue([]);

    render(<EeEntityCredentialsSection entityType="ticket" entityId="ticket-1" defaultClientId={CLIENT_ID} />);

    await waitFor(() => {
      expect(document.getElementById('ticket-credentials-section')).toBeTruthy();
    });
    expect(listCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'ticket', entityId: 'ticket-1' })
    );
  });
});

describe('per-entity section wrappers — flag-off regression (legacy surface preserved)', () => {
  it('ticket section renders nothing when the flag is off', () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(<TicketCredentialsSection ticketId="ticket-1" clientId={CLIENT_ID} />);

    expect(container.firstChild).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('contact section renders nothing when the flag is off', () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(<ContactCredentialsSection contactId="contact-1" clientId={CLIENT_ID} />);

    expect(container.firstChild).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('document section renders nothing when the flag is off', () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(<DocumentCredentialsSection documentId="doc-1" />);

    expect(container.firstChild).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('project task section renders nothing when the flag is off', () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false });

    const { container } = render(<TaskCredentialsSection taskId="task-1" />);

    expect(container.firstChild).toBeNull();
    expect(getCredentialsContextMock).not.toHaveBeenCalled();
  });

  it('ticket section mounts the EE vault scoped to the ticket when the flag is on', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true });

    render(<TicketCredentialsSection ticketId="ticket-1" clientId={CLIENT_ID} />);

    await waitFor(() => {
      const section = document.getElementById('ee-entity-section-ticket');
      expect(section?.textContent).toBe('ticket-1');
    });
  });

  it('project task section mounts the EE vault scoped to the task when the flag is on', async () => {
    useFeatureFlagMock.mockReturnValue({ enabled: true });

    render(<TaskCredentialsSection taskId="task-1" />);

    await waitFor(() => {
      const section = document.getElementById('ee-entity-section-project_task');
      expect(section?.textContent).toBe('task-1');
    });
  });
});
