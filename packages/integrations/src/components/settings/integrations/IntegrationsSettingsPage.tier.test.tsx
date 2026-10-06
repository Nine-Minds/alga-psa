// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import IntegrationsSettingsPage from './IntegrationsSettingsPage';

const state = vi.hoisted(() => ({ category: 'providers', isEnterpriseEdition: true }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ category: state.category }) }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>Paid dynamic integration</div> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({ default: ({ tabs, defaultTab }: any) => tabs.find((tab: any) => tab.id === defaultTab)?.content }));
vi.mock('@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice', () => ({ FeatureUpgradeNotice: ({ featureName, requiredTier }: any) => <div role="status">{featureName} requires {requiredTier}</div> }));
vi.mock('../../../lib/calendarAvailability', () => ({
  isCalendarEnterpriseEdition: () => state.isEnterpriseEdition,
  getVisibleIntegrationCategoryIds: () => ['providers', 'communication', 'calendar', 'identity', 'rmm', 'accounting'],
  resolveIntegrationSettingsCategory: (category: string) => category,
}));
vi.mock('./useHuduIntegrationEnabled', () => ({ useHuduIntegrationEnabled: () => ({ enabled: false }) }));
vi.mock('./ProviderCredentialsWorkbench', () => ({
  ProviderCredentialsWorkbench: ({ canUseTeams, isEnterpriseEdition }: { canUseTeams: boolean; isEnterpriseEdition: boolean }) => (
    <div data-teams-enabled={canUseTeams} data-enterprise-edition={isEnterpriseEdition}>Google and Microsoft app setup</div>
  ),
}));
vi.mock('../../email/EmailProviderConfiguration', () => ({ EmailProviderConfiguration: () => <div>Email mailbox setup</div> }));
vi.mock('./AccountingIntegrationsSetup', () => ({ default: ({ canUseLiveIntegrations }: any) => <div>Live accounting access: {String(canUseLiveIntegrations)}</div> }));
vi.mock('./RmmIntegrationsSetup', () => ({ default: () => <div>RMM connection controls</div> }));
vi.mock('./CalendarEnterpriseIntegrationSettings', () => ({ CalendarEnterpriseIntegrationSettings: () => <div>Calendar connection controls</div> }));
vi.mock('./TeamsEnterpriseIntegrationSettings', () => ({ TeamsEnterpriseIntegrationSettings: () => <div>Teams connection controls</div> }));
vi.mock('./telephony/TelephonyEnterpriseIntegrationSettings', () => ({ TelephonyEnterpriseIntegrationSettings: () => <div>Telephony connection controls</div> }));
vi.mock('@alga-psa/integrations/entra/components/entry', () => ({ EntraIntegrationSummaryCard: () => <div>Entra connection controls</div> }));

beforeEach(() => {
  state.category = 'providers';
  state.isEnterpriseEdition = true;
});
afterEach(cleanup);
describe('integration access by capability', () => {
  it.each([true, false])('keeps shared app setup in Providers without Teams controls or Pro (enterprise: %s)', (isEnterpriseEdition) => {
    state.isEnterpriseEdition = isEnterpriseEdition;
    render(<IntegrationsSettingsPage canUseIntegrations={false} />);
    const providers = screen.getByText('Google and Microsoft app setup');
    expect(providers).toBeVisible();
    expect(providers).toHaveAttribute('data-teams-enabled', String(isEnterpriseEdition));
    expect(providers).toHaveAttribute('data-enterprise-edition', String(isEnterpriseEdition));
    expect(screen.queryByText('Teams connection controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('renders the Teams wrapper in the Communication sub-section with enterprise Pro access', () => {
    state.category = 'communication';
    render(<IntegrationsSettingsPage canUseIntegrations />);
    expect(screen.getByText('Email mailbox setup')).toBeVisible();
    expect(screen.getByText('Teams connection controls')).not.toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'integrations.items.teams.name' }));

    expect(screen.getByText('Teams connection controls')).toBeVisible();
    expect(screen.getByText('Email mailbox setup')).not.toBeVisible();
    expect(screen.queryByText('Google and Microsoft app setup')).not.toBeInTheDocument();
  });
  it('omits Teams navigation and controls in Community even with Pro access', () => {
    state.category = 'communication';
    state.isEnterpriseEdition = false;
    render(<IntegrationsSettingsPage canUseIntegrations />);
    expect(screen.getByText('Email mailbox setup')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'integrations.items.teams.name' })).not.toBeInTheDocument();
    expect(screen.queryByText('Teams connection controls')).not.toBeInTheDocument();
  });
  it('keeps email available while refusing to mount paid communication controls', () => {
    state.category = 'communication';
    render(<IntegrationsSettingsPage canUseIntegrations={false} />);
    expect(screen.getByText('Email mailbox setup')).toBeInTheDocument();
    expect(screen.queryByText('Teams connection controls')).not.toBeInTheDocument();
    expect(screen.queryByText('Telephony connection controls')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.items.teams.name' }));
    expect(screen.getByRole('status')).toHaveTextContent('integrations.items.teams.name requires pro');
    expect(screen.queryByText('Teams connection controls')).not.toBeInTheDocument();
  });
  it.each(['calendar', 'identity', 'rmm'])('gates %s behind Pro, including direct category links', (category) => {
    state.category = category;
    render(<IntegrationsSettingsPage canUseIntegrations={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('requires pro');
    expect(screen.queryByText(/connection controls/)).not.toBeInTheDocument();
  });
  it('allows paid calendar settings with Pro access', () => {
    state.category = 'calendar';
    render(<IntegrationsSettingsPage canUseIntegrations />);
    expect(screen.getByText('Calendar connection controls')).toBeInTheDocument();
  });
  it('delegates live accounting gating so CSV remains accessible', () => {
    state.category = 'accounting';
    render(<IntegrationsSettingsPage canUseIntegrations={false} />);
    expect(screen.getByText('Live accounting access: false')).toBeInTheDocument();
  });
});
