/**
 * @vitest-environment jsdom
 *
 * T032/T033: the contact's Locations tile — work-arrangement badge, a row per site with the
 * Primary and inactive markers, the empty state that offers Add, and "Remote" for someone who
 * works from nowhere in particular (an empty state would be the wrong answer there).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactBentoLayout from './ContactBentoLayout';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

// Stable references: the layout lists these in effect dependencies.
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
vi.mock('@alga-psa/ui/components/Dialog', () => ({ Dialog: () => null, DialogContent: () => null }));
vi.mock('../../../context/ClientCrossFeatureContext', () => ({ useOptionalClientCrossFeature: () => null }));
vi.mock('../../interactions/QuickAddInteraction', () => ({ QuickAddInteraction: () => null }));
vi.mock('../../interactions/InteractionDetails', () => ({ default: () => null }));
vi.mock('../ContactPortalTab', () => ({ ContactPortalTab: () => null }));
vi.mock('../ContactCredentialsSection', () => ({ ContactCredentialsSection: () => null }));
vi.mock('../ContactDetailsEdit', () => ({ default: () => null }));

const baseContact: any = {
  contact_name_id: 'contact-1',
  tenant: 'tenant-1',
  full_name: 'Dorothy Gale',
  email: 'dorothy@example.com',
  client_id: 'acme',
  phone_numbers: [],
  additional_email_addresses: [],
  is_inactive: false,
};

// The full page, not the quick view: the quick view is hero + reach only by design.
const renderLayout = (contact: any) => render(<ContactBentoLayout contact={contact} clients={[]} />);

beforeEach(() => vi.clearAllMocks());

describe('ContactBentoLayout locations tile', () => {
  it('T032: badges the work arrangement and marks the primary and inactive sites', () => {
    renderLayout({
      ...baseContact,
      work_arrangement: 'hybrid',
      locations: [
        {
          location_id: 'loc-1',
          location_name: 'Warehouse',
          is_primary: true,
          is_active: true,
          address_line1: '9 Dock Rd',
          city: 'Springfield',
          postal_code: '62701',
        },
        { location_id: 'loc-2', location_name: 'Old depot', is_primary: false, is_active: false },
      ],
    });

    expect(document.querySelector('#contact-bento-locations')).toBeInTheDocument();
    expect(document.querySelector('#contact-bento-locations-arrangement')).toHaveTextContent('Hybrid');
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
    expect(screen.getByText('9 Dock Rd, Springfield, 62701 · Primary')).toBeInTheDocument();
    expect(screen.getByText('(inactive)')).toBeInTheDocument();
    // Nothing is editable in place: locations belong to the client, so the drawer owns the set.
    expect(document.querySelector('#contact-bento-locations-empty')).toBeNull();
  });

  it('T032: offers Add when the contact works nowhere yet', () => {
    renderLayout({ ...baseContact, locations: [] });

    expect(document.querySelector('#contact-bento-locations-empty')).toHaveTextContent('No locations');
    expect(document.querySelector('#contact-bento-locations-add-first')).toHaveTextContent('Add location');
    expect(document.querySelector('#contact-bento-locations-arrangement')).toBeNull();
  });

  it('T033: reads Remote for a remote contact with no links', () => {
    renderLayout({ ...baseContact, work_arrangement: 'remote', locations: [] });

    expect(document.querySelector('#contact-bento-locations-remote')).toHaveTextContent('Remote');
    expect(document.querySelector('#contact-bento-locations-empty')).toBeNull();
    expect(document.querySelector('#contact-bento-locations-arrangement')).toHaveTextContent('Remote');
  });
});
