/**
 * @vitest-environment jsdom
 *
 * T036/T037: the location card's contact-count chip expands to the people who work there, each
 * name linking to its MSP contact page, and a location the model refuses to delete keeps its card
 * and reports the dependency the model named.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getClientLocations: vi.fn(),
  getClientLocationContacts: vi.fn(),
  deleteClientLocation: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: any) => {
    const fallback = typeof options === 'string' ? options : undefined;
    let text: string = fallback
      ?? (typeof options?.count === 'number' && options.count === 1
        ? options?.defaultValue_one
        : options?.defaultValue_other)
      ?? options?.defaultValue
      ?? key;
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replace(`{{${name}}}`, String(value));
    }
    return text;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/clients/actions', () => ({
  getClientLocations: hoisted.getClientLocations,
  getClientLocationContacts: hoisted.getClientLocationContacts,
  createClientLocation: vi.fn(),
  updateClientLocation: vi.fn(),
  deleteClientLocation: hoisted.deleteClientLocation,
  setDefaultClientLocation: vi.fn(),
  getAllCountries: vi.fn().mockResolvedValue([]),
  getTenantDefaultCountry: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../lib/billingHelpers', () => ({ getActiveTaxRegionsAsync: vi.fn().mockResolvedValue([]) }));
vi.mock('../../actions/clientBillingProfileActions', () => ({ getClientBillingProfiles: vi.fn().mockResolvedValue([]) }));
vi.mock('@alga-psa/ui', () => ({ useToast: () => ({ toast: hoisted.toast }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => React.createElement('a', { href, ...rest }, children),
}));

import ClientLocations from './ClientLocations';

const warehouse: any = {
  location_id: 'loc-warehouse',
  client_id: 'acme',
  location_name: 'Warehouse',
  address_line1: '9 Dock Rd',
  city: 'Springfield',
  country_code: 'US',
  country_name: 'United States',
  is_active: true,
  is_default: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getClientLocations.mockResolvedValue([warehouse]);
  hoisted.getClientLocationContacts.mockResolvedValue({
    'loc-warehouse': [
      { contact_name_id: 'contact-1', full_name: 'Dorothy Gale', is_primary: true },
      { contact_name_id: 'contact-2', full_name: 'Toto', is_primary: false },
    ],
  });
});

describe('ClientLocations contact chip', () => {
  it('T036: counts the contacts on the card and expands to links to each of them', async () => {
    render(<ClientLocations clientId="acme" isEditing />);

    const chip = await waitFor(() => {
      const found = document.querySelector('#client-location-contact-count-loc-warehouse') as HTMLElement | null;
      expect(found).toBeInTheDocument();
      return found!;
    });
    expect(chip).toHaveTextContent('2 contacts');
    expect(hoisted.getClientLocationContacts).toHaveBeenCalledWith('acme');

    // Collapsed by default: the names appear only once the operator asks for them.
    expect(screen.queryByText('Dorothy Gale')).toBeNull();
    fireEvent.click(chip);

    expect(await screen.findByText('Dorothy Gale')).toHaveAttribute('href', '/msp/contacts/contact-1');
    expect(screen.getByText('Toto')).toHaveAttribute('href', '/msp/contacts/contact-2');
    expect(screen.getByText(/• Primary/)).toBeInTheDocument();
  });

  it('T037: a refused delete reports the dependency and leaves the card in place', async () => {
    hoisted.deleteClientLocation.mockResolvedValue({
      actionError: 'Cannot delete location: it is referenced by 2 contact(s)',
    });

    render(<ClientLocations clientId="acme" isEditing />);

    fireEvent.click(await waitFor(() => {
      const button = document.querySelector('#delete-location-loc-warehouse-button') as HTMLElement | null;
      expect(button).toBeInTheDocument();
      return button!;
    }));
    fireEvent.click(await waitFor(() => {
      const confirm = document.querySelector('#delete-location-confirmation-dialog-confirm') as HTMLElement | null;
      expect(confirm).toBeInTheDocument();
      return confirm!;
    }));

    await waitFor(() => expect(hoisted.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Cannot delete location: it is referenced by 2 contact(s)',
      variant: 'destructive',
    })));
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
  });
});
