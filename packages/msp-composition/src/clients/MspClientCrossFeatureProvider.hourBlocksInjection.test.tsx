// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The hour-blocks section is injected into the client billing dashboard via
// ClientCrossFeatureContext.renderClientHourBlocks (the renderClientOpportunities
// pattern) so the clients package never imports billing directly. This test
// pins the composition side of that seam: the provider supplies the callback
// and it renders HourBlocksSection with the caller's clientId/currencyCode.
const hourBlocksProps: Array<Record<string, unknown>> = [];

vi.mock('@alga-psa/billing/components/hour-blocks/HourBlocksSection', () => ({
  HourBlocksSection: (props: Record<string, unknown>) => {
    hourBlocksProps.push(props);
    return <div data-testid="hour-blocks-stub">hour blocks</div>;
  },
}));

vi.mock('@alga-psa/billing/components/billing-dashboard/contracts/ContractWizard', () => ({
  ContractWizard: () => null,
}));
vi.mock('@alga-psa/billing/components/billing-dashboard/contracts/ContractDialog', () => ({
  ContractDialog: () => null,
}));
vi.mock('@alga-psa/opportunities/components', () => ({
  ClientOpportunitiesTab: () => null,
}));
vi.mock('@alga-psa/tickets/components/QuickAddTicket', () => ({
  QuickAddTicket: () => null,
}));
vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getTicketFormOptions: vi.fn(async () => ({
    statusOptions: [], priorityOptions: [], boardOptions: [], categories: [], tags: [], users: [],
  })),
}));
vi.mock('@alga-psa/surveys/components/ClientSurveySummaryCard', () => ({
  default: () => null,
}));
vi.mock('@alga-psa/sla/actions/slaActions', () => ({
  getSlaPolicies: vi.fn(async () => []),
}));
vi.mock('@alga-psa/scheduling/actions/appointmentRequestManagementActions', () => ({
  getTeamsMeetingCapability: vi.fn(async () => ({ enabled: false })),
}));
vi.mock('@alga-psa/scheduling/actions/onlineMeetingSchedulingActions', () => ({
  scheduleTeamsMeeting: vi.fn(async () => ({})),
}));
vi.mock('@alga-psa/scheduling/actions/onlineMeetingArtifactActions', () => ({
  refreshMeetingRecordings: vi.fn(async () => ({})),
}));
vi.mock('./useTicketDetailsDrawer', () => ({
  useTicketDetailsDrawer: () => vi.fn(),
}));
vi.mock('./useOpportunityDetailsDrawer', () => ({
  useOpportunityDetailsDrawer: () => vi.fn(),
}));
vi.mock('./MspClientAssets', () => ({ default: () => null }));
vi.mock('./MspClientTickets', () => ({ default: () => null }));
vi.mock('./MspContactTickets', () => ({ default: () => null }));

const { MspClientCrossFeatureProvider } = await import('./MspClientCrossFeatureProvider');
const { useClientCrossFeature } = await import('@alga-psa/clients/context/ClientCrossFeatureContext');

function HourBlocksProbe() {
  const { renderClientHourBlocks } = useClientCrossFeature();
  return (
    <div>
      {renderClientHourBlocks?.({ clientId: 'client-1', currencyCode: 'EUR' }) ?? 'no-callback'}
    </div>
  );
}

describe('MspClientCrossFeatureProvider hour-blocks injection', () => {
  afterEach(() => {
    cleanup();
    hourBlocksProps.length = 0;
  });

  it('provides renderClientHourBlocks rendering HourBlocksSection with the caller props', () => {
    render(
      <MspClientCrossFeatureProvider>
        <HourBlocksProbe />
      </MspClientCrossFeatureProvider>,
    );

    expect(screen.getByTestId('hour-blocks-stub')).toBeTruthy();
    expect(hourBlocksProps).toEqual([{ clientId: 'client-1', currencyCode: 'EUR' }]);
  });
});
