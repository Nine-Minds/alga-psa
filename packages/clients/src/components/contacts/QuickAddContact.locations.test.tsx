/**
 * @vitest-environment jsdom
 *
 * T031 — quick add carries location links: with a client chosen the operator picks two of its
 * locations and a primary, and the created contact is sent with both links.
 *
 * Plus the rule that makes the dialog safe to reuse: links belong to the client that owns them, so
 * a client change and a close both drop them. The dialog stays mounted in both hosts
 * (Contacts.tsx, ClientContactsList.tsx), so leftovers would be written onto the *next* person.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  addContact: vi.fn(),
  getClientLocations: vi.fn(),
  createTagsForEntity: vi.fn(),
  toast: vi.fn(),
}));

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

vi.mock('@alga-psa/clients/actions/contact-actions/contactActions', () => ({
  addContact: hoisted.addContact,
  listContactPhoneTypeSuggestions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../actions/clientLocationActions', () => ({
  getClientLocations: hoisted.getClientLocations,
}));
vi.mock('@alga-psa/clients/actions/clientPickerActions', () => ({
  searchClientsForPicker: vi.fn().mockResolvedValue({ clients: [], total: 0 }),
}));
vi.mock('@alga-psa/clients/actions/countryActions', () => ({
  getAllCountries: vi.fn().mockResolvedValue([]),
  getTenantDefaultCountry: vi.fn().mockResolvedValue(null),
}));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntity: hoisted.createTagsForEntity,
}));
vi.mock('@alga-psa/tags/components/QuickAddTagPicker', () => ({ QuickAddTagPicker: () => null }));
vi.mock('../clients/QuickAddClient', () => ({ default: () => null }));
vi.mock('@alga-psa/ui', () => ({ useToast: () => ({ toast: hoisted.toast }) }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  // The submit button rides in the `footer` prop, so the stand-in must render it too.
  Dialog: ({ children, footer, isOpen }: any) => (isOpen ? <div>{children}{footer}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));
// Radix's select never opens under jsdom; a native one keeps the value contract.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select id={id} aria-label={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {(options ?? []).map((option: { value: string; label: string }) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ onSelect }: any) => (
    <div>
      <button type="button" id="pick-acme" onClick={() => onSelect('acme')}>Pick Acme</button>
      <button type="button" id="pick-globex" onClick={() => onSelect('globex')}>Pick Globex</button>
    </div>
  ),
}));

import QuickAddContact from './QuickAddContact';

const acmeLocations = [
  { location_id: 'loc-warehouse', location_name: 'Warehouse', is_active: true, is_default: false },
  { location_id: 'loc-hq', location_name: 'Head office', is_active: true, is_default: true },
];
const globexLocations = [
  { location_id: 'loc-depot', location_name: 'Depot', is_active: true, is_default: true },
];

const EDITOR = 'quick-add-contact-locations-editor';

/** The form has its own radios (phone/email rows), so every query is scoped to the editor. */
function editor() {
  return within(document.getElementById(EDITOR) as HTMLElement);
}

function primaryRadio(locationId: string) {
  return document.getElementById(`${EDITOR}-primary-${locationId}-${locationId}`) as HTMLInputElement;
}

function fillRequiredFields(name: string) {
  fireEvent.change(document.getElementById('quick-add-contact-name') as HTMLInputElement, {
    target: { value: name },
  });
  fireEvent.change(document.getElementById('quick-add-contact-email-primary-email') as HTMLInputElement, {
    target: { value: `${name.replace(/\s+/g, '.').toLowerCase()}@acme.com` },
  });
}

async function openLocationsFor(clientButtonId: string) {
  fireEvent.click(document.getElementById(clientButtonId) as HTMLElement);
  fireEvent.click(document.getElementById('quick-add-contact-locations-toggle') as HTMLElement);
  await waitFor(() => expect(document.getElementById(EDITOR)).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.createTagsForEntity.mockResolvedValue([]);
  hoisted.getClientLocations.mockImplementation(async (clientId: string) =>
    clientId === 'acme' ? acmeLocations : globexLocations);
  hoisted.addContact.mockResolvedValue({
    success: true,
    contact: { contact_name_id: 'new-contact', full_name: 'New Contact', tags: [] },
  });
});

describe('QuickAddContact locations', () => {
  it('T031: sends both chosen locations with the operator-picked primary and the arrangement', async () => {
    render(<QuickAddContact isOpen onClose={vi.fn()} onContactAdded={vi.fn()} />);

    await openLocationsFor('pick-acme');
    await waitFor(() => expect(editor().getByLabelText('Warehouse')).toBeInTheDocument());

    fireEvent.click(editor().getByLabelText('Warehouse'));
    fireEvent.click(editor().getByLabelText('Head office'));
    // Warehouse went in first so it holds the primary; move it to Head office deliberately.
    await waitFor(() => expect(primaryRadio('loc-warehouse')).toBeChecked());

    fireEvent.click(primaryRadio('loc-hq'));
    await waitFor(() => expect(primaryRadio('loc-hq')).toBeChecked());
    expect(primaryRadio('loc-warehouse')).not.toBeChecked();

    fireEvent.change(editor().getByLabelText(`${EDITOR}-work-arrangement`), { target: { value: 'hybrid' } });

    fillRequiredFields('Lena Field');
    fireEvent.click(screen.getByRole('button', { name: /add contact/i }));

    await waitFor(() => expect(hoisted.addContact).toHaveBeenCalledTimes(1));
    expect(hoisted.addContact.mock.calls[0]![0]).toMatchObject({
      full_name: 'Lena Field',
      client_id: 'acme',
      work_arrangement: 'hybrid',
      locations: [
        { location_id: 'loc-warehouse', is_primary: false },
        { location_id: 'loc-hq', is_primary: true },
      ],
    });
  });

  it('drops the links when the client changes, so none can be stranded off-screen', async () => {
    render(<QuickAddContact isOpen onClose={vi.fn()} onContactAdded={vi.fn()} />);

    await openLocationsFor('pick-acme');
    await waitFor(() => expect(editor().getByLabelText('Warehouse')).toBeInTheDocument());
    fireEvent.click(editor().getByLabelText('Warehouse'));
    await waitFor(() => expect(editor().getByLabelText('Warehouse')).toBeChecked());

    fireEvent.click(document.getElementById('pick-globex') as HTMLElement);
    await waitFor(() => expect(editor().getByLabelText('Depot')).toBeInTheDocument());
    expect(editor().getByLabelText('Depot')).not.toBeChecked();

    fillRequiredFields('Moved Person');
    fireEvent.click(screen.getByRole('button', { name: /add contact/i }));

    await waitFor(() => expect(hoisted.addContact).toHaveBeenCalledTimes(1));
    expect(hoisted.addContact.mock.calls[0]![0]).toMatchObject({ client_id: 'globex', locations: [] });
  });

  it('starts the next contact with no links or arrangement after a close', async () => {
    const { rerender } = render(<QuickAddContact isOpen onClose={vi.fn()} onContactAdded={vi.fn()} />);

    await openLocationsFor('pick-acme');
    await waitFor(() => expect(editor().getByLabelText('Warehouse')).toBeInTheDocument());
    fireEvent.click(editor().getByLabelText('Warehouse'));
    fireEvent.change(editor().getByLabelText(`${EDITOR}-work-arrangement`), { target: { value: 'remote' } });
    await waitFor(() => expect(editor().getByLabelText('Warehouse')).toBeChecked());

    rerender(<QuickAddContact isOpen={false} onClose={vi.fn()} onContactAdded={vi.fn()} />);
    rerender(<QuickAddContact isOpen onClose={vi.fn()} onContactAdded={vi.fn()} />);

    // The toggle carries the count, so a stale link would show here even while collapsed.
    const toggle = document.getElementById('quick-add-contact-locations-toggle') as HTMLElement;
    expect(toggle.textContent).not.toMatch(/\(1\)/);

    fireEvent.click(document.getElementById('pick-acme') as HTMLElement);
    fillRequiredFields('Second Person');
    fireEvent.click(screen.getByRole('button', { name: /add contact/i }));

    await waitFor(() => expect(hoisted.addContact).toHaveBeenCalledTimes(1));
    expect(hoisted.addContact.mock.calls[0]![0]).toMatchObject({
      full_name: 'Second Person',
      locations: [],
      work_arrangement: null,
    });
  });
});
