// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraSetupWizard } from '@ee/components/settings/integrations/entra/EntraSetupWizard';
import type { EntraStatusResponse } from '@alga-psa/integrations/actions';

const {
  discoverEntraManagedTenantsMock,
  initiateEntraDirectOAuthMock,
  startEntraSyncMock,
} = vi.hoisted(() => ({
  discoverEntraManagedTenantsMock: vi.fn(),
  initiateEntraDirectOAuthMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  discoverEntraManagedTenants: discoverEntraManagedTenantsMock,
  initiateEntraDirectOAuth: initiateEntraDirectOAuthMock,
  startEntraSync: startEntraSyncMock,
}));

// The mapping table and the CIPP dialog have their own suites; the wizard only
// needs to prove it mounts them at the right step.
vi.mock('@ee/components/settings/integrations/EntraTenantMappingTable', () => ({
  EntraTenantMappingTable: () => <div id="entra-mapping-table-stub" />,
}));

vi.mock('@ee/components/settings/integrations/EntraCippConnectDialog', () => ({
  EntraCippConnectDialog: ({ open }: { open: boolean }) =>
    open ? <div id="entra-cipp-connect-dialog-stub" /> : null,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
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

function statusOf(overrides: Partial<EntraStatusResponse> = {}): EntraStatusResponse {
  return {
    status: 'not_connected',
    connectionType: null,
    lastDiscoveryAt: null,
    mappedTenantCount: 0,
    nextSyncIntervalMinutes: null,
    availableConnectionTypes: ['direct', 'cipp'],
    lastValidatedAt: null,
    lastValidationError: null,
    ...overrides,
  };
}

function renderWizard(status: EntraStatusResponse, cippAvailable = true) {
  return render(
    <EntraSetupWizard
      status={status}
      statusLoading={false}
      cippAvailable={cippAvailable}
      onStatusChanged={vi.fn()}
    />
  );
}

describe('EntraSetupWizard', () => {
  beforeEach(() => {
    discoverEntraManagedTenantsMock.mockReset();
    initiateEntraDirectOAuthMock.mockReset();
    startEntraSyncMock.mockReset();
  });

  it('renders the action inside the current step and nowhere else', () => {
    renderWizard(statusOf());

    // Step 1 is current, so the chooser lives inside step 1's card.
    const stepOne = document.getElementById('entra-setup-step-1');
    expect(stepOne?.querySelector('#entra-connection-method-chooser')).not.toBeNull();
    expect(stepOne?.getAttribute('data-step-state')).toBe('current');

    // Later steps are present as a ladder but carry no controls to press.
    expect(document.getElementById('entra-setup-step-2')?.querySelector('button')).toBeNull();
    expect(document.getElementById('entra-setup-run-discovery')).toBeNull();
    expect(document.getElementById('entra-setup-run-initial-sync')).toBeNull();
  });

  it('discloses scopes and the contact contract before any connect action', () => {
    renderWizard(statusOf());

    const scopes = document.getElementById('entra-disclosure-scopes');
    expect(scopes?.textContent).toContain('https://graph.microsoft.com/ManagedTenants.Read.All');
    expect(scopes?.textContent).toContain('offline_access');

    const effects = document.getElementById('entra-disclosure-contact-effects');
    expect(effects?.textContent).toContain('Nothing is ever deleted.');
    expect(effects?.textContent).toContain('matched by email address');
  });

  it('offers both connection methods as focusable radios in a radiogroup', () => {
    renderWizard(statusOf());

    const group = screen.getByRole('radiogroup');
    expect(group).not.toBeNull();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      // Native inputs: reachable by keyboard rather than click-only divs.
      expect(radio.tagName).toBe('INPUT');
      expect(radio.getAttribute('type')).toBe('radio');
      expect(radio.hasAttribute('disabled')).toBe(false);
    }

    // Each option states its own prerequisites, so the choice is informed.
    expect(group.textContent).toContain('A partner relationship (GDAP)');
    expect(group.textContent).toContain('CIPP-API function app host');
  });

  it('hides CIPP entirely when the tier or flag does not allow it', () => {
    renderWizard(statusOf(), false);

    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.queryByText(/CyberDrain/)).toBeNull();
  });

  it('gates the Microsoft redirect behind the consent interstitial', async () => {
    initiateEntraDirectOAuthMock.mockResolvedValue({ success: true, data: { authUrl: 'https://login' } });
    renderWizard(statusOf());

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(initiateEntraDirectOAuthMock).not.toHaveBeenCalled();
    expect(document.getElementById('entra-direct-consent-dialog')).toBeNull();

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const dialog = document.getElementById('entra-direct-consent-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Global Administrator');
    expect(dialog?.textContent).toContain('service principal');
    // Still nothing has happened — the redirect waits for the second confirmation.
    expect(initiateEntraDirectOAuthMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Microsoft' }));
    await waitFor(() => expect(initiateEntraDirectOAuthMock).toHaveBeenCalledTimes(1));
  });

  it('opens the CIPP dialog rather than redirecting when CIPP is chosen', () => {
    renderWizard(statusOf());

    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(document.getElementById('entra-cipp-connect-dialog-stub')).not.toBeNull();
    expect(initiateEntraDirectOAuthMock).not.toHaveBeenCalled();
  });

  it('moves the action to discovery once connected', () => {
    renderWizard(statusOf({ status: 'connected', connectionType: 'direct' }));

    expect(document.getElementById('entra-connection-method-chooser')).toBeNull();
    const stepTwo = document.getElementById('entra-setup-step-2');
    expect(stepTwo?.getAttribute('data-step-state')).toBe('current');
    expect(stepTwo?.querySelector('#entra-setup-run-discovery')).not.toBeNull();
  });

  it('moves the action to mapping once discovery has run', () => {
    renderWizard(
      statusOf({
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: '2026-07-25T00:00:00.000Z',
      })
    );

    const stepThree = document.getElementById('entra-setup-step-3');
    expect(stepThree?.getAttribute('data-step-state')).toBe('current');
    expect(stepThree?.querySelector('#entra-mapping-table-stub')).not.toBeNull();
  });

  it('only enables the first sync once mappings are confirmed', () => {
    renderWizard(
      statusOf({
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: '2026-07-25T00:00:00.000Z',
        mappedTenantCount: 2,
      })
    );

    const syncButton = document.getElementById('entra-setup-run-initial-sync') as HTMLButtonElement;
    expect(syncButton).not.toBeNull();
    expect(syncButton.disabled).toBe(false);
  });
});
