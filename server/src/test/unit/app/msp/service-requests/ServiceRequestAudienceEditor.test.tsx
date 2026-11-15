/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const client = '11111111-1111-4111-8111-111111111111';
const group = '22222222-2222-4222-8222-222222222222';
const tag = '33333333-3333-4333-8333-333333333333';
const contact = '44444444-4444-4444-8444-444444444444';
const secondContact = '55555555-5555-4555-8555-555555555555';
const save = vi.fn();
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../../app/msp/service-requests/actions', () => ({
  updateServiceRequestAudienceAction: (...args: unknown[]) => save(...args),
  getServiceRequestAudienceOptionsAction: async () => ({ groups: [{ group_id: group, client_id: client, name: 'Finance' }], tags: [{ tag_id: tag, tagged_type: 'contact', tag_text: 'VIP' }] }),
  getServiceRequestAudienceReachAction: async () => ({ contacts: 1, clients: 1 }),
}));
vi.mock('@alga-psa/clients/actions/clientPickerActions', () => ({ searchClientsForPicker: async () => ({ clients: [{ client_id: client, client_name: 'Acme', displayTags: [] }] }) }));
vi.mock('@alga-psa/client-portal/actions/client-portal-actions/visibilityGroupActions', () => ({ getClientPortalVisibilityGroups: async () => [{ group_id: group, name: 'Finance' }] }));
vi.mock('@alga-psa/clients/actions', () => ({ getAllContacts: async () => [{ contact_name_id: contact, full_name: 'Jules' }, { contact_name_id: secondContact, full_name: 'Morgan' }] }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: ({ onSelect }: { onSelect: (id: string) => void }) => <button onClick={() => onSelect(client)}>Pick Acme</button> }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: ({ onValueChange }: { onValueChange: (id: string) => void }) => <button onClick={() => onValueChange(contact)}>Pick Jules</button> }));
vi.mock('@alga-psa/ui/components/tags/TagFilter', () => ({ TagFilter: ({ id, onToggleTag }: { id: string; onToggleTag: (name: string) => void }) => <button onClick={() => onToggleTag('VIP')}>{id}</button> }));
vi.mock('@alga-psa/ui/components/EntityChip', () => ({ EntityChip: ({ name }: { name: string }) => <span>{name}</span>, EntityTagBadges: () => null }));
import { ServiceRequestAudienceEditor } from '../../../../../app/msp/service-requests/ServiceRequestAudienceEditor';

describe('audience editor', () => {
  beforeEach(() => save.mockReset().mockResolvedValue({ success: true }));
  afterEach(cleanup);
  it('saves a group-only predicate through the client picker', async () => {
    render(<ServiceRequestAudienceEditor definitionId="definition" initialAudience={{ join: 'and', clauses: [] }} />);
    fireEvent.click(screen.getByLabelText('Selected clients and client users'));
    fireEvent.click(screen.getByText('Pick Acme'));
    fireEvent.click(await screen.findByLabelText(/Finance/));
    fireEvent.click(screen.getByText('Save audience'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('definition', { join: 'or', clauses: [{ path: 'contact.group.id', operator: 'in', value: [group] }] }));
  });
  it('preserves converted policies until explicitly replaced', async () => {
    const converted = { join: 'and' as const, clauses: [{ path: 'user.id', operator: 'in' as const, value: [client] }] };
    render(<ServiceRequestAudienceEditor definitionId="definition" initialAudience={converted} />);
    expect(screen.getByText('This migrated audience is preserved as a read-only policy.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save audience'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('definition', converted));
    fireEvent.click(screen.getByText('Replace with a new audience'));
    expect(screen.getByText('Pick Acme')).toBeInTheDocument();
  });  it('persists a contact entry narrowed by a contact tag', async () => {
    render(<ServiceRequestAudienceEditor definitionId="definition" initialAudience={{ join: 'or', clauses: [] }} />);
    fireEvent.click(screen.getByText('Pick Jules'));
    await screen.findByText('Jules');
    fireEvent.click(screen.getByText('audience-narrow-0'));
    fireEvent.click(screen.getByText('Save audience'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('definition', { join: 'or', clauses: [{ join: 'and', clauses: [{path: 'contact.id', operator: 'in', value: [contact]}, {path: 'contact.tags', operator: 'in', value: [tag]}] }] }));
  });
  it('shows a validation failure returned by the save action', async () => {
    save.mockResolvedValue({ success: false, message: 'Selected group no longer exists' });
    render(<ServiceRequestAudienceEditor definitionId="definition" initialAudience={{ join: 'or', clauses: [] }} />);
    fireEvent.click(screen.getByText('Save audience'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selected group no longer exists');
  });
  it.each([false, true])('renders and saves every contact in a multi-contact entry (narrowed: %s)', async (narrowed) => {
    const base = { path: 'contact.id', operator: 'in' as const, value: [contact, secondContact] };
    const entry = narrowed ? { join: 'and' as const, clauses: [base, { path: 'contact.tags', operator: 'in' as const, value: [tag] }] } : base;
    const audience = { join: 'or' as const, clauses: [entry] };
    render(<ServiceRequestAudienceEditor definitionId="definition" initialAudience={audience} />);
    expect(await screen.findByText('Jules')).toBeInTheDocument();
    expect(screen.getByText('Morgan')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save audience'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('definition', audience));
  });

});
