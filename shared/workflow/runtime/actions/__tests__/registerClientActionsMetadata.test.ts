import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerClientActions } from '../businessOperations/clients';

const EXPECTED_CLIENT_ACTION_IDS = [
  'clients.find',
  'clients.search',
  'clients.create',
  'clients.update',
  'clients.archive',
  'clients.delete',
  'clients.duplicate',
  'clients.add_tag',
  'clients.assign_to_ticket',
  'clients.add_note',
  'clients.add_interaction',
] as const;

describe('client workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('clients.add_interaction', 1)) {
      registerClientActions();
    }
  });

  it('T001: registers clients.find/search plus all mutating clients.* actions with expected labels and idempotency metadata', () => {
    const registry = getActionRegistryV2();

    const actions = EXPECTED_CLIENT_ACTION_IDS.map((id) => {
      const action = registry.get(id, 1);
      expect(action, `${id}@1 should be registered`).toBeDefined();
      return action!;
    });

    const byId = new Map(actions.map((action) => [action.id, action]));

    expect(byId.get('clients.find')?.ui?.label).toBe('Find Client');
    expect(byId.get('clients.search')?.ui?.label).toBe('Search Clients');
    expect(byId.get('clients.create')?.ui?.label).toBe('Create Client');
    expect(byId.get('clients.update')?.ui?.label).toBe('Edit Client');
    expect(byId.get('clients.archive')?.ui?.label).toBe('Archive Client');
    expect(byId.get('clients.delete')?.ui?.label).toBe('Delete Client');
    expect(byId.get('clients.duplicate')?.ui?.label).toBe('Duplicate Client');
    expect(byId.get('clients.add_tag')?.ui?.label).toBe('Add Tag to Client');
    expect(byId.get('clients.assign_to_ticket')?.ui?.label).toBe('Assign Client to Ticket');
    expect(byId.get('clients.add_note')?.ui?.label).toBe('Add Note to Client');
    expect(byId.get('clients.add_interaction')?.ui?.label).toBe('Add Interaction to Client');

    expect(byId.get('clients.create')?.sideEffectful).toBe(true);
    expect(byId.get('clients.update')?.sideEffectful).toBe(true);
    expect(byId.get('clients.archive')?.sideEffectful).toBe(true);
    expect(byId.get('clients.delete')?.sideEffectful).toBe(true);
    expect(byId.get('clients.duplicate')?.sideEffectful).toBe(true);
    expect(byId.get('clients.add_tag')?.sideEffectful).toBe(true);
    expect(byId.get('clients.assign_to_ticket')?.sideEffectful).toBe(true);
    expect(byId.get('clients.add_note')?.sideEffectful).toBe(true);
    expect(byId.get('clients.add_interaction')?.sideEffectful).toBe(true);

    expect(byId.get('clients.find')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('clients.search')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('clients.create')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('clients.update')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('clients.archive')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('clients.delete')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('clients.duplicate')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('clients.add_tag')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('clients.assign_to_ticket')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('clients.add_note')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('clients.add_interaction')?.idempotency.mode).toBe('actionProvided');
  });

  it('T003: client mutation schemas expose picker metadata for client/ticket/contact/location fields', () => {
    const registry = getActionRegistryV2();

    const assignToTicket = registry.get('clients.assign_to_ticket', 1);
    const addNote = registry.get('clients.add_note', 1);
    const addInteraction = registry.get('clients.add_interaction', 1);

    expect(assignToTicket).toBeDefined();
    expect(addNote).toBeDefined();
    expect(addInteraction).toBeDefined();

    if (!assignToTicket || !addNote || !addInteraction) {
      throw new Error('Missing expected client workflow actions');
    }

    const assignSchema = zodToWorkflowJsonSchema(assignToTicket.inputSchema);
    const addNoteSchema = zodToWorkflowJsonSchema(addNote.inputSchema);
    const addInteractionSchema = zodToWorkflowJsonSchema(addInteraction.inputSchema);

    const assignProps = assignSchema.properties as Record<string, Record<string, unknown>>;
    const addNoteProps = addNoteSchema.properties as Record<string, Record<string, unknown>>;
    const addInteractionProps = addInteractionSchema.properties as Record<string, Record<string, unknown>>;

    expect(assignProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(assignProps.ticket_id?.['x-workflow-picker-kind']).toBe('ticket');
    expect(assignProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(assignProps.contact_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);
    expect(assignProps.location_id?.['x-workflow-picker-kind']).toBe('client-location');
    expect(assignProps.location_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);

    expect(addNoteProps.client_id?.['x-workflow-picker-kind']).toBe('client');

    expect(addInteractionProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(addInteractionProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(addInteractionProps.contact_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);
    expect(addInteractionProps.ticket_id?.['x-workflow-picker-kind']).toBe('ticket');
  });
});
