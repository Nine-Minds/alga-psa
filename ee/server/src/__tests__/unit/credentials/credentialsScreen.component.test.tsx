// @vitest-environment jsdom
/**
 * Credentials vault component tests (EE CredentialsScreen + TotpCountdown):
 *  - reveal-state lifecycle: value absent before reveal, present only in
 *    transient state after reveal, cleared on Hide/Refresh, never logged.
 *  - TOTP countdown re-requests a fresh code when the window expires.
 *  - destination picker visibility rules in the create dialog.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCredentialsContextMock,
  listCredentialsMock,
  revealCredentialMock,
  createCredentialMock,
  updateCredentialMock,
  deleteCredentialMock,
  getAllClientsMock,
  useFeatureFlagMock,
} = vi.hoisted(() => ({
  getCredentialsContextMock: vi.fn(),
  listCredentialsMock: vi.fn(),
  revealCredentialMock: vi.fn(),
  createCredentialMock: vi.fn(),
  updateCredentialMock: vi.fn(),
  deleteCredentialMock: vi.fn(),
  getAllClientsMock: vi.fn(),
  useFeatureFlagMock: vi.fn(),
}));

vi.mock('@ee/lib/actions/credentials/credentialActions', () => ({
  getCredentialsContext: getCredentialsContextMock,
  listCredentials: listCredentialsMock,
  revealCredential: revealCredentialMock,
  createCredential: createCredentialMock,
  updateCredential: updateCredentialMock,
  deleteCredential: deleteCredentialMock,
  setCredentialRestriction: vi.fn(),
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
  Dialog: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (c: boolean) => void }) => (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
      {label}
    </label>
  ),
}));

import { CredentialsScreen } from '@ee/components/credentials/CredentialsScreen';
import { TotpCountdown } from '@ee/components/credentials/TotpCountdown';

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
    attachedAssetIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

async function renderScreen(props: { clientId?: string; assetId?: string } = {}) {
  render(<CredentialsScreen {...props} />);
  await waitFor(() => {
    expect(document.getElementById('credentials-screen-list')).toBeTruthy();
  });
}

const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.clearAllMocks();
  useFeatureFlagMock.mockReturnValue({ enabled: true });
  getCredentialsContextMock.mockResolvedValue({
    tierOk: true,
    huduConnected: false,
    flagIrrelevantHere: true,
  });
  listCredentialsMock.mockResolvedValue([credential()]);
  revealCredentialMock.mockResolvedValue({ state: 'ok', password: SECRET_VALUE, otpCode: null });
  createCredentialMock.mockResolvedValue(credential());
  getAllClientsMock.mockResolvedValue([{ client_id: CLIENT_ID, client_name: 'Acme Corp' }]);
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

  it('shows the tier-required message when the tier gate is closed', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: false,
      huduConnected: false,
      flagIrrelevantHere: true,
    });

    render(<CredentialsScreen />);

    await waitFor(() => {
      expect(document.getElementById('credentials-screen-tier')).toBeTruthy();
    });
    expect(listCredentialsMock).not.toHaveBeenCalled();
  });

  it('filters rows by source', async () => {
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
  it('shows the destination picker only when Hudu is connected and a client is chosen', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: true,
      huduConnected: true,
      flagIrrelevantHere: true,
    });
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
    expect(document.getElementById('credential-form-destination-alga')).toBeTruthy();
    expect(document.getElementById('credential-form-destination-hint')).toBeNull();
  });

  it('keeps the Alga-only hint when Hudu is disconnected, regardless of client', async () => {
    getCredentialsContextMock.mockResolvedValue({
      tierOk: true,
      huduConnected: false,
      flagIrrelevantHere: true,
    });
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

