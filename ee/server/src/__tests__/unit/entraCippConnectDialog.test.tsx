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
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
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

function fillCredentials(baseUrl = 'https://cipp-api.example.net', apiToken = 'key-1') {
  fireEvent.change(document.getElementById('entra-cipp-baseurl') as HTMLInputElement, {
    target: { value: baseUrl },
  });
  fireEvent.change(document.getElementById('entra-cipp-apitoken') as HTMLInputElement, {
    target: { value: apiToken },
  });
}

function renderDialog(onSuccess = vi.fn()) {
  render(<EntraCippConnectDialog open onOpenChange={vi.fn()} onSuccess={onSuccess} />);
  return { onSuccess };
}

describe('EntraCippConnectDialog', () => {
  beforeEach(() => {
    connectEntraCippMock.mockReset();
    testEntraCippCredentialsMock.mockReset();
  });

  it('names the CIPP-API host and the credential distinctly, and states encryption at rest', () => {
    renderDialog();

    expect(document.getElementById('entra-cipp-baseurl-help')?.textContent).toContain(
      'not the CIPP frontend'
    );
    expect(document.getElementById('entra-cipp-apitoken-help')?.textContent).toContain(
      'not an Azure client secret'
    );
    expect(document.getElementById('entra-cipp-encryption-note')?.textContent).toContain(
      'encrypted at rest'
    );
  });

  it('keeps Save disabled until a test passes', async () => {
    testEntraCippCredentialsMock.mockResolvedValue({
      success: true,
      data: { valid: true, checkedAt: 'now', tenantCountSample: 4, baseUrl: 'https://cipp-api.example.net' },
    });
    renderDialog();

    expect(saveButton().disabled).toBe(true);
    expect(testButton().disabled).toBe(true);

    fillCredentials();
    expect(testButton().disabled).toBe(false);
    // Credentials alone are not enough — untested is untrusted.
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(testButton());
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(document.getElementById('entra-cipp-test-result')?.textContent).toContain('4 tenants');
    expect(connectEntraCippMock).not.toHaveBeenCalled();
  });

  it('reports a failed test and leaves Save disabled', async () => {
    testEntraCippCredentialsMock.mockResolvedValue({
      success: false,
      error: 'CIPP credentials were rejected by the remote API.',
    });
    renderDialog();

    fillCredentials();
    fireEvent.click(testButton());

    await waitFor(() =>
      expect(document.getElementById('entra-cipp-test-result')?.textContent).toContain('rejected')
    );
    expect(saveButton().disabled).toBe(true);
    expect(connectEntraCippMock).not.toHaveBeenCalled();
  });

  it('invalidates a passing test when either field is edited afterwards', async () => {
    testEntraCippCredentialsMock.mockResolvedValue({
      success: true,
      data: { valid: true, checkedAt: 'now', tenantCountSample: 1, baseUrl: 'https://cipp-api.example.net' },
    });
    renderDialog();

    fillCredentials();
    fireEvent.click(testButton());
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    // Editing the token means the passing test no longer describes what would be saved.
    fireEvent.change(document.getElementById('entra-cipp-apitoken') as HTMLInputElement, {
      target: { value: 'key-2' },
    });
    expect(saveButton().disabled).toBe(true);
  });

  it('saves only after a passing test, and reports a connect failure in place', async () => {
    testEntraCippCredentialsMock.mockResolvedValue({
      success: true,
      data: { valid: true, checkedAt: 'now', tenantCountSample: 2, baseUrl: 'https://cipp-api.example.net' },
    });
    connectEntraCippMock.mockResolvedValue({ success: false, error: 'CIPP stopped responding.' });
    const { onSuccess } = renderDialog();

    fillCredentials();
    fireEvent.click(testButton());
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.click(saveButton());
    await waitFor(() => expect(connectEntraCippMock).toHaveBeenCalledTimes(1));
    expect(connectEntraCippMock).toHaveBeenCalledWith({
      baseUrl: 'https://cipp-api.example.net',
      apiToken: 'key-1',
    });
    await screen.findByText('CIPP stopped responding.');
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
