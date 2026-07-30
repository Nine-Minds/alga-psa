// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraSetupWizard } from '@ee/components/settings/integrations/entra/EntraSetupWizard';
import type { EntraStatusResponse } from '@alga-psa/integrations/actions';

const {
  disconnectEntraIntegrationMock,
  discoverEntraManagedTenantsMock,
  getEntraConfirmedMappingsMock,
  initiateEntraDirectOAuthMock,
  runEntraPreflightMock,
  startEntraSyncMock,
  updateEntraFieldSyncConfigMock,
} = vi.hoisted(() => ({
  disconnectEntraIntegrationMock: vi.fn(),
  discoverEntraManagedTenantsMock: vi.fn(),
  getEntraConfirmedMappingsMock: vi.fn(),
  initiateEntraDirectOAuthMock: vi.fn(),
  runEntraPreflightMock: vi.fn(),
  startEntraSyncMock: vi.fn(),
  updateEntraFieldSyncConfigMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  disconnectEntraIntegration: disconnectEntraIntegrationMock,
  discoverEntraManagedTenants: discoverEntraManagedTenantsMock,
  getEntraConfirmedMappings: getEntraConfirmedMappingsMock,
  initiateEntraDirectOAuth: initiateEntraDirectOAuthMock,
  runEntraPreflight: runEntraPreflightMock,
  startEntraSync: startEntraSyncMock,
  updateEntraFieldSyncConfig: updateEntraFieldSyncConfigMock,
}));

// The mapping table and the CIPP dialog have their own suites; the wizard only
// needs to prove it mounts them at the right step.
// The real table reports a summary of the rows on screen, in which "mapped"
// means "a client is selected" — a suggestion, not a saved decision.
vi.mock('@ee/components/settings/integrations/EntraTenantMappingTable', () => ({
  EntraTenantMappingTable: ({
    onSummaryChange,
  }: {
    onSummaryChange?: (summary: { mapped: number; skipped: number; needsReview: number }) => void;
  }) => {
    React.useEffect(() => {
      onSummaryChange?.({ mapped: 3, skipped: 0, needsReview: 0 });
    }, [onSummaryChange]);
    return <div id="entra-mapping-table-stub" />;
  },
}));

vi.mock('@ee/components/settings/integrations/entra/PilotSyncControl', () => ({
  PilotSyncControl: () => <div id="entra-pilot-control-stub" />,
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

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, id, title }: { isOpen: boolean; id?: string; title?: string }) =>
    isOpen ? <div id={id}>{title}</div> : null,
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

    // Later steps are a line in the ladder, not a card: no second card exists,
    // and nothing on screen offers work that cannot be started yet.
    expect(document.getElementById('entra-setup-step-2')).toBeNull();
    expect(document.getElementById('entra-setup-run-discovery')).toBeNull();
    expect(document.getElementById('entra-pilot-control-stub')).toBeNull();
  });

  it('shows all four steps in the ladder with the current one marked', () => {
    renderWizard(statusOf({ status: 'connected', connectionType: 'direct' }));

    const ladder = document.getElementById('entra-setup-ladder');
    expect(ladder?.querySelectorAll('[data-step-state]')).toHaveLength(4);
    expect(document.getElementById('entra-setup-ladder-1')?.getAttribute('data-step-state'))
      .toBe('complete');
    expect(document.getElementById('entra-setup-ladder-2')?.getAttribute('data-step-state'))
      .toBe('current');
    expect(document.getElementById('entra-setup-ladder-2')?.getAttribute('aria-current'))
      .toBe('step');
    expect(document.getElementById('entra-setup-ladder-4')?.getAttribute('data-step-state'))
      .toBe('locked');
    expect(ladder?.textContent).toContain('Preview & pilot');
  });

  it('offers a way back out once connected, so a wrong method is not a dead end', () => {
    renderWizard(statusOf({ status: 'connected', connectionType: 'cipp' }));

    expect(document.getElementById('entra-setup-connection-state')?.textContent)
      .toContain('Connected via CIPP');

    expect(document.getElementById('entra-setup-disconnect-dialog')).toBeNull();
    fireEvent.click(document.getElementById('entra-setup-disconnect') as HTMLButtonElement);
    expect(document.getElementById('entra-setup-disconnect-dialog')).not.toBeNull();
    // Confirmation first: disconnecting is not a one-click accident.
    expect(disconnectEntraIntegrationMock).not.toHaveBeenCalled();
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

  it('marks what will happen apart from what will never happen', () => {
    renderWizard(statusOf());

    const capabilities = document.getElementById('entra-disclosure-capabilities');
    expect(capabilities?.textContent).toContain('Read the list of Microsoft tenants you manage');
    expect(capabilities?.textContent).toContain('Never writes anything back to Microsoft');

    // The reassurances are marked as denials, not as more bullet points.
    const marks = Array.from(capabilities?.querySelectorAll('[data-mark]') || []).map((node) =>
      node.getAttribute('data-mark')
    );
    expect(marks).toEqual(['affirm', 'affirm', 'deny', 'deny']);

    const effectMarks = Array.from(
      document.getElementById('entra-disclosure-contact-effects')?.querySelectorAll('[data-mark]') || []
    ).map((node) => node.getAttribute('data-mark'));
    expect(effectMarks).toEqual(['affirm', 'affirm', 'caution', 'deny', 'deny']);
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
    // jsdom cannot navigate, and assigning `location.href` for real makes it log
    // an unhandled "Not implemented: navigation" error. Swap in a plain object so
    // the redirect target is assertable instead of merely implied.
    const realLocation = window.location;
    const locationStub = { href: '' } as Location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: locationStub,
    });

    renderWizard(statusOf());

    fireEvent.click(document.getElementById('entra-connection-method-continue') as HTMLButtonElement);
    expect(initiateEntraDirectOAuthMock).not.toHaveBeenCalled();
    expect(document.getElementById('entra-direct-consent-dialog')).toBeNull();

    fireEvent.click(screen.getAllByRole('radio')[0]);
    // The button names the method once one is chosen, and says what happens next.
    expect(
      document.getElementById('entra-connection-method-continue')?.textContent
    ).toContain('Continue with Direct');
    expect(document.getElementById('entra-connection-method-reassurance')?.textContent).toContain(
      'review the permission prompt'
    );
    fireEvent.click(document.getElementById('entra-connection-method-continue') as HTMLButtonElement);

    const dialog = document.getElementById('entra-direct-consent-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Global Administrator');
    expect(dialog?.textContent).toContain('service principal');
    // Still nothing has happened — the redirect waits for the second confirmation.
    expect(initiateEntraDirectOAuthMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Microsoft' }));
    await waitFor(() => expect(initiateEntraDirectOAuthMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(locationStub.href).toBe('https://login'));

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  it('opens the CIPP dialog rather than redirecting when CIPP is chosen', () => {
    renderWizard(statusOf());

    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(
      document.getElementById('entra-connection-method-continue')?.textContent
    ).toContain('Set up CIPP connection');
    fireEvent.click(document.getElementById('entra-connection-method-continue') as HTMLButtonElement);

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

  it('does not treat auto-matched suggestions as a completed mapping step', () => {
    // The tenant has discovery and the table is showing three rows with a client
    // pre-selected, but nothing has been confirmed: mappedTenantCount is still 0.
    renderWizard(
      statusOf({
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: '2026-07-25T00:00:00.000Z',
        mappedTenantCount: 0,
      })
    );

    // Advancing here strands the operator on a pilot step that tells them to go
    // back and map something, with no mapping table on screen to do it in.
    expect(document.getElementById('entra-setup-step-3')?.getAttribute('data-step-state'))
      .toBe('current');
    expect(document.getElementById('entra-setup-step-4')).toBeNull();
    expect(document.getElementById('entra-pilot-control-stub')).toBeNull();
  });

  it('lets a completed step be revisited, so the rest of the tenants can be mapped', () => {
    // One mapping confirmed advances the ladder to the pilot, but the other
    // tenants still need mapping and the table lives on step 3.
    renderWizard(
      statusOf({
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: '2026-07-25T00:00:00.000Z',
        mappedTenantCount: 1,
      })
    );

    expect(document.getElementById('entra-setup-step-4')).not.toBeNull();
    // Locked steps stay inert; completed ones are reachable.
    expect(document.getElementById('entra-setup-ladder-revisit-4')).toBeDisabled();

    fireEvent.click(document.getElementById('entra-setup-ladder-revisit-3') as HTMLButtonElement);
    expect(document.getElementById('entra-setup-step-3')?.querySelector('#entra-mapping-table-stub'))
      .not.toBeNull();

    fireEvent.click(document.getElementById('entra-setup-resume') as HTMLButtonElement);
    expect(document.getElementById('entra-setup-step-4')?.querySelector('#entra-pilot-control-stub'))
      .not.toBeNull();
  });

  it('hands the last step to the pilot control once mappings are confirmed', () => {
    renderWizard(
      statusOf({
        status: 'connected',
        connectionType: 'direct',
        lastDiscoveryAt: '2026-07-25T00:00:00.000Z',
        mappedTenantCount: 2,
      })
    );

    // The first sync is a pilot on one client, not a big-bang across all of them.
    const stepFour = document.getElementById('entra-setup-step-4');
    expect(stepFour?.getAttribute('data-step-state')).toBe('current');
    expect(stepFour?.querySelector('#entra-pilot-control-stub')).not.toBeNull();
  });
});
