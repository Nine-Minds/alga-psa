import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerContactActions } from '../businessOperations/contacts';

const EXPECTED_CONTACT_ACTION_IDS = [
  'contacts.find',
  'contacts.search',
  'contacts.create',
  'contacts.update',
  'contacts.deactivate',
  'contacts.delete',
  'contacts.duplicate',
  'contacts.add_tag',
  'contacts.assign_to_ticket',
  'contacts.add_note',
  'contacts.add_interaction',
  'contacts.add_to_client',
  'contacts.move_to_client',
] as const;

describe('contact workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('contacts.move_to_client', 1)) {
      registerContactActions();
    }
  });

  it('T001: registers all new contacts.* actions with expected labels and idempotency metadata', () => {
    const registry = getActionRegistryV2();

    const actions = EXPECTED_CONTACT_ACTION_IDS.map((id) => {
      const action = registry.get(id, 1);
      expect(action, `${id}@1 should be registered`).toBeDefined();
      return action!;
    });

    const byId = new Map(actions.map((action) => [action.id, action]));

    expect(byId.get('contacts.find')?.ui?.label).toBe('Find Contact');
    expect(byId.get('contacts.search')?.ui?.label).toBe('Search Contacts');
    expect(byId.get('contacts.create')?.ui?.label).toBe('Create Contact');
    expect(byId.get('contacts.update')?.ui?.label).toBe('Edit Contact');
    expect(byId.get('contacts.deactivate')?.ui?.label).toBe('Deactivate Contact');
    expect(byId.get('contacts.delete')?.ui?.label).toBe('Delete Contact');
    expect(byId.get('contacts.duplicate')?.ui?.label).toBe('Duplicate Contact');
    expect(byId.get('contacts.add_tag')?.ui?.label).toBe('Add Tag to Contact');
    expect(byId.get('contacts.assign_to_ticket')?.ui?.label).toBe('Assign Contact to Ticket');
    expect(byId.get('contacts.add_note')?.ui?.label).toBe('Add Note to Contact');
    expect(byId.get('contacts.add_interaction')?.ui?.label).toBe('Add Interaction to Contact');
    expect(byId.get('contacts.add_to_client')?.ui?.label).toBe('Add Contact to Client');
    expect(byId.get('contacts.move_to_client')?.ui?.label).toBe('Move Contact to Client');

    expect(byId.get('contacts.find')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('contacts.search')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('contacts.create')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('contacts.update')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('contacts.deactivate')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('contacts.delete')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('contacts.duplicate')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('contacts.add_tag')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('contacts.assign_to_ticket')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('contacts.add_note')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('contacts.add_interaction')?.idempotency.mode).toBe('actionProvided');
    expect(byId.get('contacts.add_to_client')?.idempotency.mode).toBe('engineProvided');
    expect(byId.get('contacts.move_to_client')?.idempotency.mode).toBe('engineProvided');

    for (const id of EXPECTED_CONTACT_ACTION_IDS) {
      expect(byId.get(id)?.ui?.category).toBe('Business Operations');
    }
  });

  it('T002: contact action schemas include picker metadata and compact contact output shape', () => {
    const registry = getActionRegistryV2();

    const create = registry.get('contacts.create', 1);
    const assign = registry.get('contacts.assign_to_ticket', 1);
    const addToClient = registry.get('contacts.add_to_client', 1);
    const moveToClient = registry.get('contacts.move_to_client', 1);

    expect(create).toBeDefined();
    expect(assign).toBeDefined();
    expect(addToClient).toBeDefined();
    expect(moveToClient).toBeDefined();

    if (!create || !assign || !addToClient || !moveToClient) {
      throw new Error('Missing expected contact actions');
    }

    const createInputSchema = zodToWorkflowJsonSchema(create.inputSchema);
    const assignInputSchema = zodToWorkflowJsonSchema(assign.inputSchema);
    const addToClientInputSchema = zodToWorkflowJsonSchema(addToClient.inputSchema);
    const moveToClientInputSchema = zodToWorkflowJsonSchema(moveToClient.inputSchema);
    const createOutputSchema = zodToWorkflowJsonSchema(create.outputSchema);

    const createInputProps = createInputSchema.properties as Record<string, Record<string, unknown>>;
    const assignInputProps = assignInputSchema.properties as Record<string, Record<string, unknown>>;
    const addToClientInputProps = addToClientInputSchema.properties as Record<string, Record<string, unknown>>;
    const moveToClientInputProps = moveToClientInputSchema.properties as Record<string, Record<string, unknown>>;

    expect(createInputProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(assignInputProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(assignInputProps.ticket_id?.['x-workflow-picker-kind']).toBe('ticket');
    expect(addToClientInputProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(addToClientInputProps.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(moveToClientInputProps.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(moveToClientInputProps.target_client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(moveToClientInputProps.expected_current_client_id?.['x-workflow-picker-kind']).toBe('client');

    const outputProps = createOutputSchema.properties as Record<string, any>;
    const contactShape = outputProps.contact?.properties as Record<string, any>;
    expect(contactShape).toBeTruthy();
    expect(contactShape.contact_name_id).toBeTruthy();
    expect(contactShape.full_name).toBeTruthy();
    expect(contactShape.email).toBeTruthy();
    expect(contactShape.phone).toBeTruthy();
    expect(contactShape.client_id).toBeTruthy();
    expect(contactShape.is_inactive).toBeTruthy();
  });
});
