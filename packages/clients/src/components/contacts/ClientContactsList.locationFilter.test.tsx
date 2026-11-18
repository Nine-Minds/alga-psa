/**
 * @vitest-environment jsdom
 *
 * T035 — the client Contacts tab's Location filter: one option per location the people on screen
 * work at, plus Remote (contacts whose arrangement says so) and No location (nobody's site), and
 * the Location column reading the primary name with a +N for the rest.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClientContactsList from './ClientContactsList';

const hoisted = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  replaceDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  getContactsByClient: vi.fn(),
  getContactByContactNameId: vi.fn(),
  getAllClients: vi.fn(),
  searchContactListIds: vi.fn(),
  getCurrentUserAsync: vi.fn(),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({
    openDrawer: hoisted.openDrawer,
    replaceDrawer: hoisted.replaceDrawer,
    closeDrawer: hoisted.closeDrawer,
  }),
}));

// `t` must be referentially stable: the component lists it as an effect dependency.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; [k: string]: unknown }) => {
    let text = options?.defaultValue ?? key;
    for (const [name, value] of Object.entries(options ?? {})) {
      text = text.replace(`{{${name}}}`, String(value));
    }
    return text;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/clients/actions', () => ({
  getContactsByClient: hoisted.getContactsByClient,
  getContactByContactNameId: hoisted.getContactByContactNameId,
  getAllClients: hoisted.getAllClients,
  searchContactListIds: hoisted.searchContactListIds,
}));
vi.mock('../../lib/usersHelpers', () => ({ getCurrentUserAsync: hoisted.getCurrentUserAsync }));
vi.mock('./ContactDetailsEdit', () => ({ default: () => null }));
vi.mock('./bento/ContactQuickView', () => ({ default: () => null }));
vi.mock('./QuickAddContact', () => ({ default: () => null }));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ getDocumentsByEntity: vi.fn() }),
}));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/PhoneText', () => ({ PhoneText: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _c, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
// Radix's select never opens under jsdom; a native one keeps the option list and value contract.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} aria-label={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {(options ?? []).map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: any) => (
    <div>
      {data.map((row: any) => (
        <div key={row.contact_name_id} data-testid={`row-${row.contact_name_id}`}>
          {columns.map((column: any, index: number) => (
            <div key={index}>{column.render ? column.render(row[column.dataIndex], row, 0) : null}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: any) => <div>{children}</div>,
  Trigger: ({ children }: any) => <>{children}</>,
  Content: ({ children }: any) => <div>{children}</div>,
  Item: ({ children, onSelect }: any) => (
    <button type="button" onClick={() => onSelect?.()}>{children}</button>
  ),
}));

const client: any = { client_id: 'acme', client_name: 'Acme', is_inactive: false, location_country_code: 'US' };

const location = (id: string, name: string, isPrimary: boolean) => ({
  location_id: id,
  location_name: name,
  is_primary: isPrimary,
  is_active: true,
});

const warehouseWorker: any = {
  contact_name_id: 'contact-warehouse',
  full_name: 'Wanda Warehouse',
  email: 'wanda@acme.com',
  client_id: 'acme',
  phone_numbers: [],
  work_arrangement: 'on_site',
  locations: [location('loc-warehouse', 'Warehouse', true), location('loc-hq', 'Head office', false)],
  primaryLocation: { location_id: 'loc-warehouse', location_name: 'Warehouse' },
};
const remoteWorker: any = {
  contact_name_id: 'contact-remote',
  full_name: 'Rhea Remote',
  email: 'rhea@acme.com',
  client_id: 'acme',
  phone_numbers: [],
  work_arrangement: 'remote',
  locations: [],
  primaryLocation: null,
};
const unlinkedWorker: any = {
  contact_name_id: 'contact-unlinked',
  full_name: 'Una Unlinked',
  email: 'una@acme.com',
  client_id: 'acme',
  phone_numbers: [],
  work_arrangement: null,
  locations: [],
  primaryLocation: null,
};

const filter = () => screen.getByLabelText('contact-location-filter') as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getContactsByClient.mockResolvedValue([warehouseWorker, remoteWorker, unlinkedWorker]);
  hoisted.getAllClients.mockResolvedValue([client]);
  hoisted.getCurrentUserAsync.mockResolvedValue({ user_id: 'user-1' });
});

describe('ClientContactsList Location filter', () => {
  it('T035: offers the on-screen locations plus Remote and No location', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-warehouse');

    const options = [...filter().options].map((option) => `${option.value}|${option.textContent}`);
    expect(options).toEqual([
      'all|All locations',
      // Sorted by name, so two sites read the same way the column does.
      'loc-hq|Head office',
      'loc-warehouse|Warehouse',
      'remote|Remote',
      'none|No location',
    ]);
  });

  it('T035: narrows to a location, to Remote and to the unlinked', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    await screen.findByTestId('row-contact-warehouse');

    fireEvent.change(filter(), { target: { value: 'loc-hq' } });
    await waitFor(() => expect(screen.queryByTestId('row-contact-remote')).not.toBeInTheDocument());
    // A non-primary link still counts as working there.
    expect(screen.getByTestId('row-contact-warehouse')).toBeInTheDocument();

    fireEvent.change(filter(), { target: { value: 'remote' } });
    await waitFor(() => expect(screen.getByTestId('row-contact-remote')).toBeInTheDocument());
    expect(screen.queryByTestId('row-contact-warehouse')).not.toBeInTheDocument();
    // A remote worker is not "no location": the two options answer different questions.
    expect(screen.queryByTestId('row-contact-unlinked')).not.toBeInTheDocument();

    fireEvent.change(filter(), { target: { value: 'none' } });
    await waitFor(() => expect(screen.getByTestId('row-contact-unlinked')).toBeInTheDocument());
    expect(screen.queryByTestId('row-contact-warehouse')).not.toBeInTheDocument();

    fireEvent.change(filter(), { target: { value: 'all' } });
    await waitFor(() => expect(screen.getByTestId('row-contact-warehouse')).toBeInTheDocument());
  });

  it('T035: the Location column names the primary, counts the rest and says Remote', async () => {
    render(<ClientContactsList clientId="acme" client={client} />);
    const warehouseRow = await screen.findByTestId('row-contact-warehouse');

    expect(warehouseRow.textContent).toContain('Warehouse');
    expect(warehouseRow.textContent).toContain('+1');
    expect(screen.getByTestId('row-contact-remote').textContent).toContain('Remote');
  });
});
