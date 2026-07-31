// @vitest-environment jsdom
/**
 * T031–T034 — HuduIntegrationSettings component (settings-ui group).
 *
 * jsdom + @testing-library, mirroring the EntraIntegrationSettings component
 * tests: the hudu server actions, UI primitives, toast hook, and i18n are all
 * mocked; assertions run against the rendered DOM.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HuduIntegrationSettings from '@ee/components/settings/integrations/HuduIntegrationSettings';

const {
  connectHuduMock,
  disconnectHuduMock,
  getHuduConnectionStatusMock,
  testHuduConnectionMock,
  toastMock,
} = vi.hoisted(() => ({
  connectHuduMock: vi.fn(),
  disconnectHuduMock: vi.fn(),
  getHuduConnectionStatusMock: vi.fn(),
  testHuduConnectionMock: vi.fn(),
  toastMock: vi.fn(),
}));

// Same module as the component's relative import (vitest dedupes by resolved id).
vi.mock('@ee/lib/actions/integrations/huduActions', () => ({
  connectHudu: connectHuduMock,
  disconnectHudu: disconnectHuduMock,
  getHuduConnectionStatus: getHuduConnectionStatusMock,
  testHuduConnection: testHuduConnectionMock,
}));

// The mapping and layout-map managers have their own dedicated component
// tests; stub them here so connected-state renders don't pull in their
// actions modules.
vi.mock('@ee/components/settings/integrations/hudu/HuduCompanyMappingManager', () => ({
  default: () => <div data-testid="hudu-company-mapping-manager-stub" />,
}));

vi.mock('@ee/components/settings/integrations/hudu/HuduAssetLayoutMapManager', () => ({
  default: () => <div data-testid="hudu-asset-layout-map-manager-stub" />,
}));

vi.mock('@ee/components/settings/integrations/hudu/HuduSyncAutomationManager', () => ({
  default: () => <div data-testid="hudu-sync-automation-manager-stub" />,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable identity: the component memoizes callbacks on `t`.
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock, toasts: [] }),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
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
  Input: ({
    id,
    label,
    error,
    value,
    onChange,
    type,
    placeholder,
    disabled,
    autoComplete,
  }: {
    id?: string;
    label?: string;
    error?: string;
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
    autoComplete?: string;
  }) => (
    <div>
      {label ? <label htmlFor={id}>{label}</label> : null}
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
      />
      {error ? <p data-testid={`${id}-error`}>{error}</p> : null}
    </div>
  ),
}));

const notConnectedStatus = {
  connected: false,
  isActive: false,
  baseUrl: null,
  connectedAt: null,
  lastSyncedAt: null,
  passwordAccess: false,
};

const connectedStatus = {
  connected: true,
  isActive: true,
  baseUrl: 'https://docs.example.com',
  connectedAt: '2026-06-09T00:00:00.000Z',
  lastSyncedAt: null,
  passwordAccess: true,
};

describe('HuduIntegrationSettings', () => {
  beforeEach(() => {
    connectHuduMock.mockReset();
    disconnectHuduMock.mockReset();
    getHuduConnectionStatusMock.mockReset();
    testHuduConnectionMock.mockReset();
    toastMock.mockReset();
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: notConnectedStatus });
  });

  it('T031: renders base URL field, masked API key field, and Test/Connect/Disconnect buttons', async () => {
    render(<HuduIntegrationSettings />);

    const baseUrlInput = (await screen.findByLabelText('Base URL')) as HTMLInputElement;
    expect(baseUrlInput.type).toBe('text');

    const apiKeyInput = screen.getByLabelText('API key') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('T031: Disconnect is disabled while not connected', async () => {
    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    const disconnectButton = screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement;
    expect(disconnectButton.disabled).toBe(true);
  });

  it('T032: shows the Not connected badge when no connection exists', async () => {
    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    expect(document.getElementById('hudu-connection-status-badge')?.textContent).toBe('Not connected');
    expect(document.getElementById('hudu-password-access-indicator')).toBeNull();
  });

  it('T032: shows Connected badge, detected instance, and password-access indicator when connected', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });

    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    expect(document.getElementById('hudu-connection-status-badge')?.textContent).toBe('Connected');
    expect(document.getElementById('hudu-detected-instance')?.textContent).toBe('https://docs.example.com');
    expect(document.getElementById('hudu-password-access-indicator')?.textContent).toBe('Password access enabled');
  });

  it('T032: flags missing password access on the indicator when connected without it', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({
      success: true,
      data: { ...connectedStatus, passwordAccess: false },
    });

    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    expect(document.getElementById('hudu-password-access-indicator')?.textContent).toBe(
      'Password access not enabled for this key'
    );
  });

  it('T032: shows the Error badge when the status load fails', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: false, error: 'boom' });

    render(<HuduIntegrationSettings />);

    await waitFor(() => {
      expect(document.getElementById('hudu-connection-status-badge')?.textContent).toBe('Error');
    });
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('T033: API key input is empty on load even when connected, and base URL is prefilled', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });

    render(<HuduIntegrationSettings />);

    const apiKeyInput = (await screen.findByLabelText('API key')) as HTMLInputElement;
    expect(apiKeyInput.value).toBe('');

    const baseUrlInput = screen.getByLabelText('Base URL') as HTMLInputElement;
    expect(baseUrlInput.value).toBe('https://docs.example.com');
  });

  it('T033: connecting with a blank key omits api key from the payload (keeps stored key)', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });
    connectHuduMock.mockResolvedValue({ success: true, data: connectedStatus });

    render(<HuduIntegrationSettings />);
    await screen.findByLabelText('API key');

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(connectHuduMock).toHaveBeenCalledTimes(1);
    });
    expect(connectHuduMock).toHaveBeenCalledWith({ baseUrl: 'https://docs.example.com' });
    expect(connectHuduMock.mock.calls[0][0]).not.toHaveProperty('apiKey');
  });

  it('T033: testing with a blank key omits api key from the payload', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });
    testHuduConnectionMock.mockResolvedValue({
      success: true,
      data: { connected: true, passwordAccess: true },
    });

    render(<HuduIntegrationSettings />);
    await screen.findByLabelText('API key');

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(testHuduConnectionMock).toHaveBeenCalledTimes(1);
    });
    expect(testHuduConnectionMock).toHaveBeenCalledWith({ baseUrl: 'https://docs.example.com' });
    expect(testHuduConnectionMock.mock.calls[0][0]).not.toHaveProperty('apiKey');
  });

  it('T033: a typed key is sent, then cleared from the field after a successful connect', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });
    connectHuduMock.mockResolvedValue({ success: true, data: connectedStatus });

    render(<HuduIntegrationSettings />);
    const apiKeyInput = (await screen.findByLabelText('API key')) as HTMLInputElement;

    fireEvent.change(apiKeyInput, { target: { value: 'new-api-key-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(connectHuduMock).toHaveBeenCalledWith({
        baseUrl: 'https://docs.example.com',
        apiKey: 'new-api-key-123',
      });
    });
    await waitFor(() => {
      expect(apiKeyInput.value).toBe('');
    });
  });

  it('T034: invalid base URL format shows inline validation without calling the server', async () => {
    render(<HuduIntegrationSettings />);
    const baseUrlInput = await screen.findByLabelText('Base URL');

    fireEvent.change(baseUrlInput, { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    const inlineError = await screen.findByTestId('hudu-base-url-error');
    expect(inlineError.textContent).toContain(
      'Enter a valid URL, e.g. https://your-instance.huducloud.com'
    );
    expect(testHuduConnectionMock).not.toHaveBeenCalled();
  });

  it('T034: a 404 (not_found) test result surfaces the base-URL error message and toast', async () => {
    testHuduConnectionMock.mockResolvedValue({
      success: true,
      data: { connected: false, passwordAccess: false, errorKind: 'not_found', error: 'HTTP 404' },
    });

    render(<HuduIntegrationSettings />);
    const baseUrlInput = await screen.findByLabelText('Base URL');

    fireEvent.change(baseUrlInput, { target: { value: 'https://wrong.example.com' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'some-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await screen.findByText('No Hudu API was found at this base URL (404). Check the base URL.');
    expect(document.getElementById('hudu-connection-status-badge')?.textContent).toBe('Error');
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: 'No Hudu API was found at this base URL (404). Check the base URL.',
      })
    );
  });

  it('T034: a 401 (invalid_key) test result surfaces the invalid-key message and toast', async () => {
    testHuduConnectionMock.mockResolvedValue({
      success: true,
      data: { connected: false, passwordAccess: false, errorKind: 'invalid_key', error: 'HTTP 401' },
    });

    render(<HuduIntegrationSettings />);
    const baseUrlInput = await screen.findByLabelText('Base URL');

    fireEvent.change(baseUrlInput, { target: { value: 'https://docs.example.com' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await screen.findByText('Hudu rejected the API key (401). Enter a valid API key.');
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: 'Hudu rejected the API key (401). Enter a valid API key.',
      })
    );
  });

  it('T034: a connect failure with an errorKind maps to the same clear message', async () => {
    connectHuduMock.mockResolvedValue({ success: false, error: 'HTTP 401', errorKind: 'invalid_key' });

    render(<HuduIntegrationSettings />);
    const baseUrlInput = await screen.findByLabelText('Base URL');

    fireEvent.change(baseUrlInput, { target: { value: 'https://docs.example.com' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await screen.findByText('Hudu rejected the API key (401). Enter a valid API key.');
    expect(document.getElementById('hudu-connection-status-badge')?.textContent).toBe('Error');
  });

  it('renders the company mapping manager below the card when connected', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });

    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    expect(screen.getByTestId('hudu-company-mapping-manager-stub')).toBeTruthy();
  });

  it('does not render the company mapping manager when not connected', async () => {
    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    expect(screen.queryByTestId('hudu-company-mapping-manager-stub')).toBeNull();
  });

  it('T208: renders the asset layout map manager below the card when connected', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });

    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    expect(screen.getByTestId('hudu-asset-layout-map-manager-stub')).toBeTruthy();
  });

  it('T208: does not render the asset layout map manager when not connected', async () => {
    render(<HuduIntegrationSettings />);

    await screen.findByLabelText('Base URL');
    expect(screen.queryByTestId('hudu-asset-layout-map-manager-stub')).toBeNull();
  });

  it('disconnect calls the action and reloads status', async () => {
    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: connectedStatus });
    disconnectHuduMock.mockResolvedValue({ success: true, data: { disconnected: true } });

    render(<HuduIntegrationSettings />);
    await screen.findByLabelText('Base URL');

    getHuduConnectionStatusMock.mockResolvedValue({ success: true, data: notConnectedStatus });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await screen.findByText('Hudu connection disconnected.');
    expect(disconnectHuduMock).toHaveBeenCalledTimes(1);
    expect(getHuduConnectionStatusMock).toHaveBeenCalledTimes(2);
  });
});
