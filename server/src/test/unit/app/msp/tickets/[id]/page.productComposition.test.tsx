import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getCurrentUserMock = vi.fn();
const getCurrentTenantProductMock = vi.fn();
const getConsolidatedTicketDataMock = vi.fn();
const getSurveyTicketSummaryMock = vi.fn();
const getTicketByIdMock = vi.fn();

function MspTicketDetailsContainerClientMock() {
  return null;
}

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getConsolidatedTicketData: getConsolidatedTicketDataMock,
}));

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketById: getTicketByIdMock,
}));

vi.mock('@alga-psa/surveys/actions/survey-actions/surveyDashboardActions', () => ({
  getSurveyTicketSummary: getSurveyTicketSummaryMock,
}));

vi.mock('@alga-psa/assets/components/AssociatedAssets', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/msp-composition/tickets', () => ({
  MspTicketDetailsContainerClient: MspTicketDetailsContainerClientMock,
}));

const { default: TicketDetailsPage } = await import('server/src/app/msp/tickets/[id]/page');

describe('MSP ticket details page product composition', () => {
  const findElementByType = (node: unknown, targetType: unknown): React.ReactElement | null => {
    if (!node || typeof node !== 'object') return null;
    const element = node as React.ReactElement<{ children?: unknown }>;
    if (element.type === targetType) return element;

    const children = element.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        const match = findElementByType(child, targetType);
        if (match) return match;
      }
      return null;
    }
    return findElementByType(children, targetType);
  };

  const getRenderedDetailProps = async () => {
    const result = await TicketDetailsPage({ params: Promise.resolve({ id: 'ticket-1' }) });
    const detailsContainer = findElementByType(result, MspTicketDetailsContainerClientMock);
    if (!detailsContainer) {
      throw new Error('Expected ticket details client element in render tree');
    }
    return detailsContainer.props as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });
    getConsolidatedTicketDataMock.mockResolvedValue({
      ticket: {
        ticket_id: 'ticket-1',
        client_id: 'client-1',
        board_id: 'board-1',
      },
      comments: [],
      documents: [],
      client: null,
      contacts: [],
      contactInfo: null,
      createdByUser: null,
      board: null,
      additionalAgents: [],
      availableAgents: [],
      userMap: {},
      options: {
        status: [],
        agent: [],
        board: [],
        priority: [],
      },
      categories: [],
      clients: [],
      locations: [],
      agentSchedules: [],
    });
    getTicketByIdMock.mockResolvedValue({ ticket_number: 1, title: 'Ticket 1' });
    getSurveyTicketSummaryMock.mockResolvedValue({ score: null });
  });

  it('routes Algadesk tenants through Algadesk detail mode', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');

    const props = await getRenderedDetailProps();

    expect(props.isAlgadeskMode).toBe(true);
    expect(props.associatedAssets).toBeNull();
  });

  it('keeps PSA detail mode enabled for PSA tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');

    const props = await getRenderedDetailProps();

    expect(props.isAlgadeskMode).toBe(false);
    expect(getSurveyTicketSummaryMock).toHaveBeenCalled();
  });
});
