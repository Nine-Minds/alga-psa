// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraCippConnectDialog } from '@ee/components/settings/integrations/EntraCippConnectDialog';

const { connectEntraCippMock, testEntraCippCredentialsMock } = vi.hoisted(() => ({
  connectEntraCippMock: vi.fn(),
  testEntraCippCredentialsMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  connectEntraCipp: connectEntraCippMock,
  testEntraCippCredentials: testEntraCippCredentialsMock,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer, id }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    id?: string;
  }) => (isOpen ? <div id={id}>{children}{footer}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

const saveButton = () => document.getElementById('entra-cipp-submit') as HTMLButtonElement;
const testButton = () => document.getElementById('entra-cipp-test') as HTMLButtonElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const text = (id: string) => document.getElementById(id)?.textContent ?? '';

const GUID_A = '11111111-1111-1111-1111-111111111111';
const GUID_B = '22222222-2222-2222-2222-222222222222';

const API_CLIENT_FIELDS = {
  'entra-cipp-apiurl': 'https://cipp-api.example.net/api',
  'entra-cipp-clientid': GUID_A,
  'entra-cipp-clientsecret': 'secret-1',
  'entra-cipp-tenantid': GUID_B,
} as const;

function fillApiClient(overrides: Partial<Record<keyof typeof API_CLIENT_FIELDS, string>> = {}) {
  for (const [id, value] of Object.entries({ ...API_CLIENT_FIELDS, ...overrides })) {
    fireEvent.change(field(id), { target: { value } });
  }
}

function fillLegacy(baseUrl = 'https://cipp-api.example.net', apiToken = 'key-1') {
  fireEvent.change(field('entra-cipp-baseurl'), { target: { value: baseUrl } });
  fireEvent.change(field('entra-cipp-apitoken'), { target: { value: apiToken } });
}

function passingTest(tenantCountSample = 4) {
  testEntraCippCredentialsMock.mockResolvedValue({
    success: true,
    data: { valid: true, checkedAt: 'now', tenantCountSample, baseUrl: 'https://cipp-api.example.net' },
  });
}

function renderDialog(props: Partial<React.ComponentProps<typeof EntraCippConnectDialog>> = {}) {
  const onSuccess = vi.fn();
  render(<EntraCippConnectDialog open onOpenChange={vi.fn()} onSuccess={onSuccess} {...props} />);
  return { onSuccess };
}

async function testAndWaitForSave() {
  fireEvent.click(testButton());
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

describe('EntraCippConnectDialog', () => {
  beforeEach(() => {
    connectEntraCippMock.mockReset();
    testEntraCippCredentialsMock.mockReset();
  });

  it('defaults to the API-client shape with a masked secret and current CIPP guidance', () => {
    renderDialog();

    expect(field('entra-cipp-apiurl')).toBeTruthy();
    expect(field('entra-cipp-clientid')).toBeTruthy();
    expect(field('entra-cipp-tenantid')).toBeTruthy();
    expect(field('entra-cipp-clientsecret').type).toBe('password');
    expect(document.getElementById('entra-cipp-apitoken')).toBeNull();

    const help = text('entra-cipp-help');
    const order = ['Integrations > CIPP-API', 'Create New Client', 'Enable the client', 'Save to Azure', 'only once', 'Tenant ID and the API URL'];
    const positions = order.map((needle) => help.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text('entra-cipp-help-tenant-delay')).toContain('5 to 15 minutes');
    expect(text('entra-cipp-help-restrictions')).toContain('Allowed IP Ranges');
    expect(text('entra-cipp-help-restrictions')).toContain('Custom Role');
    expect(document.body.textContent).not.toContain('function app host');
    expect(document.body.textContent).not.toContain('API access');
    expect(text('entra-cipp-encryption-note')).toContain('encrypted at rest');
  });

  it('keeps Save disabled until a test passes for the values on screen', async () => {
    passingTest();
    renderDialog();

    expect(saveButton().disabled).toBe(true);
    expect(testButton().disabled).toBe(true);

    fillApiClient();
    expect(testButton().disabled).toBe(false);
    // Credentials alone are not enough: untested is untrusted.
    expect(saveButton().disabled).toBe(true);

    await testAndWaitForSave();
    expect(text('entra-cipp-test-result')).toContain('4 tenants');
    expect(connectEntraCippMock).not.toHaveBeenCalled();
  });

  it.each([
    ['entra-cipp-apiurl', 'https://other.example.net/api'],
    ['entra-cipp-clientid', GUID_B],
    ['entra-cipp-clientsecret', 'secret-2'],
    ['entra-cipp-tenantid', GUID_A],
  ])('turns Save off again when %s changes after a passing test', async (id, value) => {
    passingTest();
    renderDialog();
    fillApiClient();
    await testAndWaitForSave();

    fireEvent.change(field(id), { target: { value } });
    expect(saveButton().disabled).toBe(true);
  });

  it.each([
    ['entra-cipp-baseurl', 'https://other.example.net'],
    ['entra-cipp-apitoken', 'key-2'],
  ])('turns Save off again when legacy %s changes after a passing test', async (id, value) => {
    passingTest();
    renderDialog();
    fireEvent.click(document.getElementById('entra-cipp-use-legacy') as HTMLButtonElement);
    fillLegacy();
    await testAndWaitForSave();

    fireEvent.change(field(id), { target: { value } });
    expect(saveButton().disabled).toBe(true);
  });

  it('sends the API-client shape with the URL normalized, and only after a passing test', async () => {
    passingTest(2);
    connectEntraCippMock.mockResolvedValue({ success: false, error: 'CIPP stopped responding.' });
    const { onSuccess } = renderDialog();

    fillApiClient({ 'entra-cipp-apiurl': '  cipp-api.example.net/api/ ' });
    await testAndWaitForSave();
    expect(testEntraCippCredentialsMock).toHaveBeenCalledWith({
      authType: 'api_client',
      apiUrl: 'https://cipp-api.example.net',
      clientId: GUID_A,
      clientSecret: 'secret-1',
      tenantId: GUID_B,
    });

    fireEvent.click(saveButton());
    await waitFor(() => expect(connectEntraCippMock).toHaveBeenCalledTimes(1));
    expect(connectEntraCippMock).toHaveBeenCalledWith(testEntraCippCredentialsMock.mock.calls[0][0]);
    await screen.findByText('CIPP stopped responding.');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('treats the URL with and without /api as the same tested value', async () => {
    passingTest();
    renderDialog();
    fillApiClient({ 'entra-cipp-apiurl': 'https://cipp-api.example.net' });
    await testAndWaitForSave();

    // Same host written the way CIPP shows it: still the tested value.
    fireEvent.change(field('entra-cipp-apiurl'), { target: { value: 'https://cipp-api.example.net/api' } });
    expect(saveButton().disabled).toBe(true); // an edit clears the result...
    fireEvent.click(testButton());
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(testEntraCippCredentialsMock.mock.calls[1][0].apiUrl).toBe('https://cipp-api.example.net');
  });

  it('shows the URL the way CIPP does once the field loses focus', () => {
    renderDialog();
    fireEvent.change(field('entra-cipp-apiurl'), { target: { value: 'cipp-api.example.net' } });
    fireEvent.blur(field('entra-cipp-apiurl'));
    expect(field('entra-cipp-apiurl').value).toBe('https://cipp-api.example.net/api');
  });

  it('clears the other shape\'s fields and test result when switching', async () => {
    passingTest();
    renderDialog();
    fillApiClient();
    await testAndWaitForSave();

    fireEvent.click(document.getElementById('entra-cipp-use-legacy') as HTMLButtonElement);
    expect(field('entra-cipp-baseurl').value).toBe('');
    expect(field('entra-cipp-apitoken').value).toBe('');
    expect(saveButton().disabled).toBe(true);

    fillLegacy();
    fireEvent.click(document.getElementById('entra-cipp-use-api-client') as HTMLButtonElement);
    expect(field('entra-cipp-apiurl').value).toBe('');
    expect(field('entra-cipp-clientid').value).toBe('');
    expect(field('entra-cipp-clientsecret').value).toBe('');
    expect(field('entra-cipp-tenantid').value).toBe('');
    expect(saveButton().disabled).toBe(true);
    expect(text('entra-cipp-test-result')).toContain('Test the connection');
  });

  it('keeps the legacy form behind the explicit switch and submits the legacy shape', async () => {
    passingTest();
    connectEntraCippMock.mockResolvedValue({ success: true, data: { status: 'connected' } });
    const { onSuccess } = renderDialog();

    fireEvent.click(document.getElementById('entra-cipp-use-legacy') as HTMLButtonElement);
    fillLegacy('https://cipp-api.example.net/api', 'key-1');
    await testAndWaitForSave();
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(connectEntraCippMock).toHaveBeenCalledWith({
      baseUrl: 'https://cipp-api.example.net',
      apiToken: 'key-1',
    });
  });

  it.each([
    ['html_response', 'Use the CIPP-API URL shown in CIPP', 'could not be reached at this URL'],
    ['validation_failed', 'CIPP validation request failed.', 'could not be reached at this URL'],
    ['token_mint_failed', 'Microsoft rejected the client secret. Check the secret.', "rejected the API client's sign-in"],
    ['token_scope_rejected', 'The token scope was rejected.', "rejected the API client's sign-in"],
    ['ip_blocked', 'add our egress IPs under Allowed IP Ranges.', 'refused the access token'],
    ['auth_rejected', 'confirm the client is enabled and its Role allows API access', 'refused the access token'],
  ])('renders the %s failure with its remedy', async (code, remedy, title) => {
    testEntraCippCredentialsMock.mockResolvedValue({ success: false, error: remedy, code });
    renderDialog();
    fillApiClient();
    fireEvent.click(testButton());

    await waitFor(() => expect(text('entra-cipp-test-failure-remedy')).toBe(remedy));
    expect(text('entra-cipp-test-failure-title')).toContain(title);
    expect(saveButton().disabled).toBe(true);
    expect(connectEntraCippMock).not.toHaveBeenCalled();
  });

  it.each([
    ['dns', 'the host name does not resolve'],
    ['refused', 'the connection was refused'],
    ['timeout', 'the request timed out'],
    ['tls', 'TLS certificate was not accepted'],
    ['network', 'the network request failed'],
  ])('explains an unreachable host by its transport cause (%s), in the UI language', async (cause, phrase) => {
    testEntraCippCredentialsMock.mockResolvedValue({
      success: false,
      error: 'server-side English message',
      code: 'unreachable',
      cause,
    });
    renderDialog();
    fillApiClient({ 'entra-cipp-apiurl': 'https://cipp-typo.example.net/api' });
    fireEvent.click(testButton());

    await waitFor(() => expect(text('entra-cipp-test-failure-remedy')).toContain(phrase));
    expect(text('entra-cipp-test-failure-remedy')).toContain('cipp-typo.example.net');
    expect(text('entra-cipp-test-failure-remedy')).not.toContain('server-side English message');
    expect(text('entra-cipp-test-failure-title')).toContain('could not be reached');
    expect(saveButton().disabled).toBe(true);
  });

  it('titles a Custom Role that blocks listusers as a role problem', async () => {
    const remedy = "CIPP refused listusers with HTTP 403 while other endpoints work, so the API client's Custom Role is blocking it. In CIPP, give the role access to listusers.";
    testEntraCippCredentialsMock.mockResolvedValue({ success: false, error: remedy, code: 'role_blocked' });
    renderDialog();
    fillApiClient();
    fireEvent.click(testButton());

    await waitFor(() => expect(text('entra-cipp-test-failure-remedy')).toBe(remedy));
    expect(text('entra-cipp-test-failure-title')).toContain('Custom Role blocks a permission sync needs');
    expect(saveButton().disabled).toBe(true);
  });

  it('titles a rejected legacy key as such', async () => {
    testEntraCippCredentialsMock.mockResolvedValue({
      success: false,
      error: 'CIPP credentials were rejected by the remote API.',
      code: 'auth_rejected',
    });
    renderDialog();
    fireEvent.click(document.getElementById('entra-cipp-use-legacy') as HTMLButtonElement);
    fillLegacy();
    fireEvent.click(testButton());
    await waitFor(() => expect(text('entra-cipp-test-failure-title')).toContain('rejected the API key'));
  });

  it('pre-fills a reconnect from the non-secret details and leaves the secret empty', () => {
    renderDialog({
      reconnect: {
        authType: 'api_client',
        apiUrl: 'https://cipp-api.example.net',
        clientId: GUID_A,
        tenantId: GUID_B,
      },
    });

    expect(field('entra-cipp-apiurl').value).toBe('https://cipp-api.example.net/api');
    expect(field('entra-cipp-clientid').value).toBe(GUID_A);
    expect(field('entra-cipp-tenantid').value).toBe(GUID_B);
    expect(field('entra-cipp-clientsecret').value).toBe('');
    expect(text('entra-cipp-reconnect-note')).toContain('Enter the client secret again');
    expect(text('entra-cipp-reconnect-note')).toContain('Tenant ID are filled in');
    // Everything but the secret is present, yet Save and Test stay off.
    expect(testButton().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it('opens a legacy connection\'s reconnect in the API-client shape, without the legacy key', () => {
    renderDialog({
      reconnect: {
        authType: 'legacy_api_token',
        apiUrl: 'https://cipp-api.example.net',
        clientId: null,
        tenantId: null,
      },
    });

    expect(field('entra-cipp-apiurl').value).toBe('https://cipp-api.example.net/api');
    expect(field('entra-cipp-clientid').value).toBe('');
    expect(field('entra-cipp-tenantid').value).toBe('');
    expect(document.getElementById('entra-cipp-apitoken')).toBeNull();
    expect(document.getElementById('entra-cipp-clientsecret')).not.toBeNull();
    // Only the API URL is pre-filled, and the note must say so.
    expect(text('entra-cipp-reconnect-note')).toContain('The API URL is filled in from the current connection');
    expect(text('entra-cipp-reconnect-note')).not.toContain('Tenant ID are filled in');
    // Opening it saved nothing.
    expect(connectEntraCippMock).not.toHaveBeenCalled();
  });

  it('reconnects a legacy connection as an API client once the new client tests clean', async () => {
    passingTest(2);
    connectEntraCippMock.mockResolvedValue({
      success: true,
      data: { status: 'connected', connectionType: 'cipp', baseUrl: 'https://cipp-api.example.net' },
    });
    const { onSuccess } = renderDialog({
      reconnect: {
        authType: 'legacy_api_token',
        apiUrl: 'https://cipp-api.example.net',
        clientId: null,
        tenantId: null,
      },
    });

    fireEvent.change(field('entra-cipp-clientid'), { target: { value: GUID_A } });
    fireEvent.change(field('entra-cipp-clientsecret'), { target: { value: 'secret-1' } });
    fireEvent.change(field('entra-cipp-tenantid'), { target: { value: GUID_B } });
    await testAndWaitForSave();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    const expected = {
      authType: 'api_client',
      apiUrl: 'https://cipp-api.example.net',
      clientId: GUID_A,
      clientSecret: 'secret-1',
      tenantId: GUID_B,
    };
    expect(testEntraCippCredentialsMock).toHaveBeenCalledWith(expected);
    expect(connectEntraCippMock).toHaveBeenCalledWith(expected);
  });
});
