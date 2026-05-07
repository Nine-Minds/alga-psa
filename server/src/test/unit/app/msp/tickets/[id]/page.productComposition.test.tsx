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
      comments: [{ comment_id: 'comment-1' }],
      documents: [{ document_id: 'doc-1' }],
      client: { client_id: 'client-1' },
      contacts: [{ contact_name_id: 'contact-1' }],
      contactInfo: { contact_name_id: 'contact-1' },
      createdByUser: { user_id: 'user-creator-1' },
      board: { board_id: 'board-1' },
      additionalAgents: [{ user_id: 'user-2' }],
      availableAgents: [{ user_id: 'user-3' }],
      userMap: { 'user-3': { user_id: 'user-3' } },
      options: {
        status: [{ value: 'status-1', label: 'Open' }],
        agent: [{ value: 'user-3', label: 'Agent' }],
        board: [{ value: 'board-1', label: 'Default' }],
        priority: [{ value: 'priority-1', label: 'Normal' }],
      },
      categories: [{ category_id: 'category-1', category_name: 'Incident' }],
      clients: [{ client_id: 'client-1' }],
      locations: [{ location_id: 'location-1' }],
      agentSchedules: [{ userId: 'user-3', minutes: 15 }],
    });
    getTicketByIdMock.mockResolvedValue({ ticket_number: 1, title: 'Ticket 1' });
    getSurveyTicketSummaryMock.mockResolvedValue({ score: null });
  });

  it('routes Algadesk tenants through Algadesk detail mode', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');

    const props = await getRenderedDetailProps();

    expect(props.isAlgadeskMode).toBe(true);
    expect(props.associatedAssets).toBeNull();
    expect(props.ticketData.comments).toHaveLength(1);
    expect(props.ticketData.documents).toHaveLength(1);
    expect(props.ticketData.options.status).toHaveLength(1);
    expect(props.ticketData.options.priority).toHaveLength(1);
    expect(props.ticketData.categories).toHaveLength(1);
    expect(props.ticketData.client.client_id).toBe('client-1');
    expect(props.ticketData.contactInfo.contact_name_id).toBe('contact-1');
    expect(getSurveyTicketSummaryMock).not.toHaveBeenCalled();
  });

  it('keeps PSA detail mode enabled for PSA tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');

    const props = await getRenderedDetailProps();

    expect(props.isAlgadeskMode).toBe(false);
    expect(getSurveyTicketSummaryMock).toHaveBeenCalled();
  });
});
