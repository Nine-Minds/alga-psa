import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

const getCurrentTenantProductMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getContactByContactNameIdMock = vi.fn();
const getAllClientsMock = vi.fn();
const getContactPortalPermissionsMock = vi.fn();
const getDocumentsByEntityMock = vi.fn();

function ContactDetailsMock() {
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
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getContactPortalPermissions: getContactPortalPermissionsMock,
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocumentsByEntity: getDocumentsByEntityMock,
}));

vi.mock('@alga-psa/clients', () => ({
  ContactDetails: ContactDetailsMock,
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

  const getRenderedContactDetailProps = async (tab?: string) => {
    const result = await ContactPage({
      params: Promise.resolve({ id: 'contact-1' }),
      searchParams: Promise.resolve(tab ? { tab } : {}),
    });
    const details = findElementByType(result, ContactDetailsMock);
    if (!details) {
      throw new Error('Expected contact details element in render tree');
    }
    return details.props as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    getContactByContactNameIdMock.mockResolvedValue({ contact_name_id: 'contact-1', full_name: 'Test Contact' });
    getAllClientsMock.mockResolvedValue([{ client_id: 'client-1' }]);
    getContactPortalPermissionsMock.mockResolvedValue({ canInvite: true, canUpdateRoles: true, canRead: true });
    getDocumentsByEntityMock.mockResolvedValue([{ document_id: 'doc-1' }]);
  });

  it('routes Algadesk tenants through Algadesk-safe contact detail mode', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');

    const props = await getRenderedContactDetailProps('documents');

    expect(props.isAlgadeskMode).toBe(true);
    expect(props.documents).toEqual([]);
    expect(getDocumentsByEntityMock).not.toHaveBeenCalled();
  });

  it('keeps PSA contact detail composition for PSA tenants', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');

    const props = await getRenderedContactDetailProps('documents');

    expect(props.isAlgadeskMode).toBe(false);
    expect(props.documents).toEqual([{ document_id: 'doc-1' }]);
    expect(getDocumentsByEntityMock).toHaveBeenCalledWith('contact-1', 'contact');
  });
});
