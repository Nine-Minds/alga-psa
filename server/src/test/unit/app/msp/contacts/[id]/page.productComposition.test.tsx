import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getCurrentTenantProductMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getContactByContactNameIdMock = vi.fn();
const getAllClientsMock = vi.fn();
const getContactPortalPermissionsMock = vi.fn();
const getDocumentsByEntityMock = vi.fn();
const getInteractionsForEntityMock = vi.fn();
const getContactStatsMock = vi.fn();
const getContactTicketsSummaryMock = vi.fn();
const getContactRelatedWorkMock = vi.fn();
const getContactPortalSummaryMock = vi.fn();
const findTagsByEntityIdsMock = vi.fn();

function ContactBentoLayoutMock() {
  return null;
}

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getContactByContactNameId: getContactByContactNameIdMock,
  getAllClients: getAllClientsMock,
  getContactPortalSummary: getContactPortalSummaryMock,
  getContactRelatedWork: getContactRelatedWorkMock,
  getContactStats: getContactStatsMock,
  getContactTicketsSummary: getContactTicketsSummaryMock,
  getInteractionsForEntity: getInteractionsForEntityMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getContactPortalPermissions: getContactPortalPermissionsMock,
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocumentsByEntity: getDocumentsByEntityMock,
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityIds: findTagsByEntityIdsMock,
  isTagActionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'error' in value),
}));

vi.mock('@alga-psa/tickets/lib/createTicketRoute', () => ({
  buildCreateTicketHref: vi.fn(() => '/msp/tickets/new'),
}));

vi.mock('@alga-psa/clients', () => ({
  ContactBentoLayout: ContactBentoLayoutMock,
}));

vi.mock('@product/chat/context', () => ({
  AIChatContextBoundary: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn().mockResolvedValue({
    t: (_key: string, fallback?: { defaultValue?: string }) => fallback?.defaultValue ?? '',
  }),
}));

const { default: ContactPage } = await import('server/src/app/msp/contacts/[id]/page');

describe('MSP contact detail page product composition', () => {
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

  const getRenderedBentoLayoutProps = async () => {
    const result = await ContactPage({
      params: Promise.resolve({ id: 'contact-1' }),
    });
    const layout = findElementByType(result, ContactBentoLayoutMock);
    if (!layout) {
      throw new Error('Expected contact bento layout element in render tree');
    }
    return layout.props as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getContactByContactNameIdMock.mockResolvedValue({ contact_name_id: 'contact-1', full_name: 'Test Contact' });
    getAllClientsMock.mockResolvedValue([{ client_id: 'client-1' }]);
    getContactPortalPermissionsMock.mockResolvedValue({ canInvite: true, canUpdateRoles: true, canRead: true });
    getDocumentsByEntityMock.mockResolvedValue([{ document_id: 'doc-1' }]);
    getInteractionsForEntityMock.mockResolvedValue([]);
    getContactStatsMock.mockResolvedValue(null);
    getContactTicketsSummaryMock.mockResolvedValue(null);
    getContactRelatedWorkMock.mockResolvedValue(null);
    getContactPortalSummaryMock.mockResolvedValue(null);
    findTagsByEntityIdsMock.mockResolvedValue([]);
  });

  it('routes AlgaDesk tenants through AlgaDesk-safe contact detail mode', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');

    const props = await getRenderedBentoLayoutProps();

    expect(props.showDocuments).toBe(false);
    expect(props.documents).toEqual([]);
    expect(getDocumentsByEntityMock).not.toHaveBeenCalled();
    expect(props.showRelatedWork).toBe(false);
    expect(props.relatedWork).toBeNull();
    expect(getContactRelatedWorkMock).not.toHaveBeenCalled();
  });

  it('keeps PSA contact detail composition for PSA tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');

    const props = await getRenderedBentoLayoutProps();

    expect(props.showDocuments).toBe(true);
    expect(props.documents).toEqual([{ document_id: 'doc-1' }]);
    expect(getDocumentsByEntityMock).toHaveBeenCalledWith('contact-1', 'contact');
    expect(props.showRelatedWork).toBe(true);
    expect(getContactRelatedWorkMock).toHaveBeenCalledWith('contact-1');
  });
});
