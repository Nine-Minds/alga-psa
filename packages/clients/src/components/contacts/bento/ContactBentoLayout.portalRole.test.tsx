/**
 * @vitest-environment jsdom
 *
 * alga-2026-0003347: the portal tile prints the contact's portal role from
 * `contact.is_client_admin`, which is a mirror of the client 'Admin' role once a
 * portal user exists. The Portal tab inside this screen is where that role is
 * added and removed, so the line has to follow it instead of waiting for a
 * reload.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactBentoLayout from './ContactBentoLayout';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => {
  const toast = vi.fn();
  const drawer = { openDrawer: hoisted.openDrawer, closeDrawer: hoisted.closeDrawer };
  const toastApi = { toast };
  return { useDrawer: () => drawer, useToast: () => toastApi };
});
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  const value = { t };
  return { useTranslation: () => value };
});
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => {
  const value = { renderDocuments: () => null, getDocumentsByEntity: vi.fn() };
  return { useDocumentsCrossFeature: () => value };
});
vi.mock('@alga-psa/clients/actions', () => ({
  updateContact: vi.fn(),
  getInteractionsForEntity: vi.fn().mockResolvedValue([]),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/contacts/contact-1',
}));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ usePageCreateShortcut: () => undefined }));
// Render the dialog body unconditionally so the portal tab below is mounted
// without having to open the dialog first.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('../../../context/ClientCrossFeatureContext', () => ({ useOptionalClientCrossFeature: () => null }));
vi.mock('../../interactions/QuickAddInteraction', () => ({ QuickAddInteraction: () => null }));
vi.mock('../../interactions/InteractionDetails', () => ({ default: () => null }));
// Stands in for the real tab: the role change it performs is reported back
// through onPortalAdminChanged.
vi.mock('../ContactPortalTab', () => ({
  ContactPortalTab: ({ onPortalAdminChanged }: any) => (
    <button type="button" onClick={() => onPortalAdminChanged?.(false)}>
      drop the admin role
    </button>
  ),
}));
vi.mock('../ContactCredentialsSection', () => ({ ContactCredentialsSection: () => null }));
vi.mock('../ContactDetailsEdit', () => ({ default: () => null }));

const contact: any = {
  contact_name_id: 'contact-1',
  tenant: 'tenant-1',
  full_name: 'Dorothy Gale',
  email: 'dorothy@example.com',
  client_id: 'acme',
  phone_numbers: [],
  additional_email_addresses: [],
  is_inactive: false,
  is_client_admin: true,
};

beforeEach(() => vi.clearAllMocks());

describe('ContactBentoLayout portal role line', () => {
  it('follows a role change made in the portal tab', () => {
    render(
      <ContactBentoLayout
        contact={contact}
        clients={[]}
        userPermissions={{ canInvite: true, canUpdateRoles: true, canRead: true }}
        portalSummary={{ hasAccount: true, accountInactive: false, lastSignIn: null, invitedAt: null } as any}
      />
    );

    expect(screen.getByText('Client admin')).toBeInTheDocument();

    fireEvent.click(screen.getByText('drop the admin role'));

    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.queryByText('Client admin')).not.toBeInTheDocument();
  });
});
