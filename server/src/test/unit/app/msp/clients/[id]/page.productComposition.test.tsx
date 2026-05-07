import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getCurrentTenantProductMock = vi.fn();
const getClientByIdMock = vi.fn();
const getDocumentByClientIdMock = vi.fn();
const getContactsByClientMock = vi.fn();
const getSurveyClientSummaryMock = vi.fn();

function ClientDetailsMock() {
  return null;
}

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientById: getClientByIdMock,
  getContactsByClient: getContactsByClientMock,
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocumentByClientId: getDocumentByClientIdMock,
}));

vi.mock('@alga-psa/surveys/actions/survey-actions/surveyDashboardActions', () => ({
  getSurveyClientSummary: getSurveyClientSummaryMock,
}));

vi.mock('@alga-psa/clients', () => ({
  ClientDetails: ClientDetailsMock,
}));

const { default: ClientPage } = await import('server/src/app/msp/clients/[id]/page');

describe('MSP client detail page product composition', () => {
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

  const getRenderedClientDetailProps = async () => {
    const result = await ClientPage({ params: Promise.resolve({ id: 'client-1' }) });
    const details = findElementByType(result, ClientDetailsMock);
    if (!details) {
      throw new Error('Expected client details element in render tree');
    }
    return details.props as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getClientByIdMock.mockResolvedValue({ client_id: 'client-1', client_name: 'Acme' });
    getDocumentByClientIdMock.mockResolvedValue([{ document_id: 'doc-1' }]);
    getContactsByClientMock.mockResolvedValue([{ contact_name_id: 'contact-1' }]);
    getSurveyClientSummaryMock.mockResolvedValue({ score: null });
  });

  it('routes Algadesk tenants through Algadesk-safe client detail mode', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');

    const props = await getRenderedClientDetailProps();

    expect(props.isAlgadeskMode).toBe(true);
    expect(props.documents).toEqual([]);
    expect(getDocumentByClientIdMock).not.toHaveBeenCalled();
    expect(getSurveyClientSummaryMock).not.toHaveBeenCalled();
  });

  it('keeps PSA client detail composition for PSA tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');

    const props = await getRenderedClientDetailProps();

    expect(props.isAlgadeskMode).toBe(false);
    expect(props.documents).toEqual([{ document_id: 'doc-1' }]);
    expect(getDocumentByClientIdMock).toHaveBeenCalledWith('client-1');
    expect(getSurveyClientSummaryMock).toHaveBeenCalledWith('client-1');
  });
});
