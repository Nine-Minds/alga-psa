// @vitest-environment jsdom
/**
 * T055 — the per-client recurring overrides: choosing a contact fills an empty Location with that
 * person's own site, and never touches one the operator already picked. Generated tickets inherit
 * these values, so a silent re-point here would send an engineer to the wrong address every month.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { RecurringClientOverridesDialog } from '../RecurringClientOverridesDialog';

const mocks = vi.hoisted(() => ({
  translate: (key: string, fallback?: string | Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : fallback?.defaultValue;
    return typeof template === 'string' ? template : key;
  },
  getRecurringTicketDefinition: vi.fn(),
  updateRecurringTicketClient: vi.fn(),
  getContactsByClient: vi.fn(),
  getClientLocations: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.translate, i18n: { language: 'en' } }),
}));
vi.mock('../../../actions/recurringTicketActions', () => ({
  getRecurringTicketDefinition: mocks.getRecurringTicketDefinition,
  updateRecurringTicketClient: mocks.updateRecurringTicketClient,
}));
vi.mock('../../../actions/clientLookupActions', () => ({
  getContactsByClient: mocks.getContactsByClient,
  getClientLocations: mocks.getClientLocations,
}));
vi.mock('../RecurringTicketsFeatureContext', () => ({
  useRecurringTicketsCrossFeature: () => ({ renderAssetPicker: () => null }),
}));
vi.mock('../../useTicketFieldReferenceData', () => ({
  useTicketFieldReferenceData: () => ({
    boards: [], statuses: [], priorities: [], categories: [], users: [], teams: [],
    ensureBoard: vi.fn(async () => undefined),
  }),
}));
vi.mock('../RecurringFieldGroups', () => ({
  BoardFields: () => null,
  PriorityFields: () => null,
  CategoryFields: () => null,
  AssignmentFields: () => null,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
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
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({ id, contacts, onValueChange }: any) => (
    <div>
      {contacts.map((contact: any) => (
        <button
          key={contact.contact_name_id}
          type="button"
          id={`${id}-pick-${contact.contact_name_id}`}
          onClick={() => onValueChange(contact.contact_name_id)}
        >
          {contact.full_name}
        </button>
      ))}
    </div>
  ),
}));

const location = (id: string, name: string, isPrimary: boolean) => ({
  location_id: id,
  location_name: name,
  is_primary: isPrimary,
  is_active: true,
});

const warehouseWorker = {
  contact_name_id: 'contact-warehouse',
  full_name: 'Wanda Warehouse',
  locations: [location('loc-warehouse', 'Warehouse', true), location('loc-hq', 'Head office', false)],
};
const unlinkedWorker = {
  contact_name_id: 'contact-unlinked',
  full_name: 'Una Unlinked',
  locations: [],
};

function definition(overrides: { contact_id?: string | null; location_id?: string | null } = {}) {
  return {
    definition_id: 'def-1',
    effective_fields: {
      board_id: null, status_id: null, priority_id: null, category_id: null, subcategory_id: null,
      assigned_to: null, assigned_team_id: null, additional_agent_ids: [],
    },
    clients: [{
      definition_client_id: 'dc-1',
      definition_id: 'def-1',
      client_id: 'acme',
      client_name: 'Acme',
      is_active: true,
      overrides: {},
      contact_id: overrides.contact_id ?? null,
      location_id: overrides.location_id ?? null,
      asset_ids: [],
    }],
  };
}

const locationSelect = () => screen.getByLabelText('recurring-client-overrides-location') as HTMLSelectElement;

const renderDialog = () => render(
  <RecurringClientOverridesDialog
    isOpen
    onClose={vi.fn()}
    definitionId="def-1"
    definitionClientId="dc-1"
    onSaved={vi.fn()}
  />,
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getContactsByClient.mockResolvedValue([warehouseWorker, unlinkedWorker]);
  mocks.getClientLocations.mockResolvedValue([
    { location_id: 'loc-warehouse', location_name: 'Warehouse' },
    { location_id: 'loc-hq', location_name: 'Head office' },
  ]);
  mocks.updateRecurringTicketClient.mockResolvedValue({ success: true });
});

afterEach(() => cleanup());

describe('RecurringClientOverridesDialog location pre-fill', () => {
  it('T055: an empty Location takes the chosen contact\'s primary site', async () => {
    mocks.getRecurringTicketDefinition.mockResolvedValue(definition());
    renderDialog();

    await waitFor(() => expect(locationSelect().value).toBe(''));
    screen.getByText('Wanda Warehouse').click();

    await waitFor(() => expect(locationSelect().value).toBe('loc-warehouse'));
  });

  it('T055: a Location the operator picked is left alone', async () => {
    mocks.getRecurringTicketDefinition.mockResolvedValue(definition({ location_id: 'loc-hq' }));
    renderDialog();

    await waitFor(() => expect(locationSelect().value).toBe('loc-hq'));
    screen.getByText('Wanda Warehouse').click();

    await waitFor(() => expect(screen.getByText('Wanda Warehouse')).toBeTruthy());
    expect(locationSelect().value).toBe('loc-hq');
  });

  it('T055: an unlinked contact leaves the Location empty', async () => {
    mocks.getRecurringTicketDefinition.mockResolvedValue(definition());
    renderDialog();

    await waitFor(() => expect(locationSelect().value).toBe(''));
    screen.getByText('Una Unlinked').click();

    await waitFor(() => expect(screen.getByText('Una Unlinked')).toBeTruthy());
    expect(locationSelect().value).toBe('');
  });
});
