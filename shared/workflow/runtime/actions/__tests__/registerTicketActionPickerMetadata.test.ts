import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerTicketActions } from '../businessOperations/tickets';

describe('ticket workflow picker metadata', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('tickets.create', 1)) {
      registerTicketActions();
    }
  });

  it('T169/T170/T171/T172/T173/T174/T175/T176/T177/T178/T179/T220: exports ticket-core picker metadata from real workflow actions without expanding dependent scope beyond ticket-core identifiers', () => {
    const registry = getActionRegistryV2();
    const createAction = registry.get('tickets.create', 1);
    const updateAction = registry.get('tickets.update_fields', 1);
    const assignAction = registry.get('tickets.assign', 1);

    expect(createAction).toBeDefined();
    expect(updateAction).toBeDefined();
    expect(assignAction).toBeDefined();
    if (!createAction || !updateAction || !assignAction) {
      throw new Error('Expected ticket workflow actions to be registered');
    }

    const createSchema = zodToWorkflowJsonSchema(createAction.inputSchema);
    const updateSchema = zodToWorkflowJsonSchema(updateAction.inputSchema);
    const assignSchema = zodToWorkflowJsonSchema(assignAction.inputSchema);

    const createProperties = createSchema.properties as Record<string, Record<string, unknown>>;
    const updatePatchProperties =
      ((updateSchema.properties as Record<string, Record<string, unknown>>).patch?.properties as Record<
        string,
        Record<string, unknown>
      >) ?? {};
    const createAssigneeProperties =
      (createProperties.assignee?.properties as Record<string, Record<string, unknown>>) ?? {};
    const assignAssigneeProperties =
      (((assignSchema.properties as Record<string, Record<string, unknown>>).assignee?.properties ??
        {}) as Record<string, Record<string, unknown>>);

    expect(createProperties.client_id?.['x-workflow-picker-kind']).toBe('client');
    expect(createProperties.client_id?.['x-workflow-picker-allow-dynamic-reference']).toBe(true);

    expect(createProperties.contact_id?.['x-workflow-picker-kind']).toBe('contact');
    expect(createProperties.contact_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);

    expect(createProperties.board_id?.['x-workflow-picker-kind']).toBe('board');
    expect(createProperties.board_id?.['x-workflow-picker-dependencies']).toBeUndefined();
    expect(createProperties.status_id?.['x-workflow-picker-kind']).toBe('ticket-status');
    expect(createProperties.status_id?.['x-workflow-picker-dependencies']).toEqual(['board_id']);
    expect(createProperties.priority_id?.['x-workflow-picker-kind']).toBe('ticket-priority');
    expect(createProperties.priority_id?.['x-workflow-picker-dependencies']).toBeUndefined();
    expect(createProperties.assigned_to?.['x-workflow-picker-kind']).toBe('user');
    expect(createProperties.assigned_to?.['x-workflow-picker-dependencies']).toBeUndefined();
    expect(createProperties.category_id?.['x-workflow-picker-kind']).toBe('ticket-category');
    expect(createProperties.category_id?.['x-workflow-picker-dependencies']).toEqual(['board_id']);
    expect(createProperties.subcategory_id?.['x-workflow-picker-kind']).toBe('ticket-subcategory');
    expect(createProperties.subcategory_id?.['x-workflow-picker-dependencies']).toEqual([
      'board_id',
      'category_id',
    ]);
    expect(createProperties.location_id?.['x-workflow-picker-kind']).toBe('client-location');
    expect(createProperties.location_id?.['x-workflow-picker-dependencies']).toEqual(['client_id']);

    expect(createAssigneeProperties.id?.['x-workflow-picker-kind']).toBe('user-or-team');
    expect(createAssigneeProperties.id?.['x-workflow-picker-dependencies']).toEqual(['assignee.type']);
    expect(assignAssigneeProperties.id?.['x-workflow-picker-kind']).toBe('user-or-team');

    expect(updatePatchProperties.status_id?.['x-workflow-picker-kind']).toBe('ticket-status');
    expect(updatePatchProperties.status_id?.['x-workflow-picker-dependencies']).toEqual(['ticket_id']);
    expect(updatePatchProperties.priority_id?.['x-workflow-picker-kind']).toBe('ticket-priority');
    expect(updatePatchProperties.priority_id?.['x-workflow-picker-dependencies']).toBeUndefined();
    expect(updatePatchProperties.assigned_to?.['x-workflow-picker-kind']).toBe('user');
    expect(updatePatchProperties.assigned_to?.['x-workflow-picker-dependencies']).toBeUndefined();
    expect(updatePatchProperties.category_id?.['x-workflow-picker-kind']).toBe('ticket-category');
    expect(updatePatchProperties.category_id?.['x-workflow-picker-dependencies']).toBeUndefined();
    expect(updatePatchProperties.subcategory_id?.['x-workflow-picker-kind']).toBe(
      'ticket-subcategory'
    );
    expect(updatePatchProperties.subcategory_id?.['x-workflow-picker-dependencies']).toBeUndefined();
    expect(updatePatchProperties.location_id?.['x-workflow-picker-kind']).toBe('client-location');
    expect(updatePatchProperties.location_id?.['x-workflow-picker-dependencies']).toBeUndefined();
  });
});
