import { describe, expect, it, vi } from 'vitest';
import { AlgaPsa } from '../nodes/AlgaPsa/AlgaPsa.node';
import { createLoadOptionsHarness } from './testUtils';

function getProperty(node: AlgaPsa, name: string) {
  const prop = node.description.properties.find((property) => property.name === name);
  if (!prop) {
    throw new Error(`Property ${name} not found`);
  }

  return prop;
}

describe('Node description and load options', () => {
  it('T001: resource selector includes Ticket, Contact, Project Task, Client, Board, Status, and Priority', () => {
    const node = new AlgaPsa();
    const resource = getProperty(node, 'resource');
    const resourceValues = resource.options?.map((option) => option.value);

    expect(resourceValues).toEqual([
      'ticket',
      'contact',
      'projectTask',
      'client',
      'board',
      'status',
      'priority',
    ]);
  });

  it('T002: operation selectors expose only valid operations per resource', () => {
    const node = new AlgaPsa();

    const ticketOperations = getProperty(node, 'ticketOperation').options?.map((o) => o.value);
    const contactOperations = getProperty(node, 'contactOperation').options?.map((o) => o.value);
    const projectTaskOperations = getProperty(node, 'projectTaskOperation').options?.map(
      (o) => o.value,
    );
    const clientOperations = getProperty(node, 'clientOperation').options?.map((o) => o.value);
    const boardOperations = getProperty(node, 'boardOperation').options?.map((o) => o.value);
    const statusOperations = getProperty(node, 'statusOperation').options?.map((o) => o.value);
    const priorityOperations = getProperty(node, 'priorityOperation').options?.map((o) => o.value);

    expect(ticketOperations).toEqual([
      'create',
      'get',
      'list',
      'listComments',
      'search',
      'update',
      'addComment',
      'updateStatus',
      'updateAssignment',
      'delete',
    ]);
    expect(contactOperations).toEqual(['create', 'get', 'list', 'update', 'delete']);
    expect(projectTaskOperations).toEqual(['create', 'get', 'list', 'update', 'delete']);
    expect(clientOperations).toEqual(['list']);
    expect(boardOperations).toEqual(['list']);
    expect(statusOperations).toEqual(['list']);
    expect(priorityOperations).toEqual(['list']);
  });

  it('T003: node subtitle includes contact operations in the selected operation fallback chain', () => {
    const node = new AlgaPsa();

    expect(node.description.subtitle).toContain('$parameter["contactOperation"]');
  });

  it('T036: client load-options maps API records to label/value list', async () => {
    const node = new AlgaPsa();
    const context = createLoadOptionsHarness({
      requestHandler: () => ({
        data: [{ client_id: 'client-1', client_name: 'Acme Corp' }],
        pagination: { page: 1 },
      }),
    });

    const result = await node.methods.listSearch.searchClients.call(context, 'acme');
    expect(result.results).toEqual([{ name: 'Acme Corp', value: 'client-1' }]);
  });

  it('T037: board load-options maps API records to label/value list', async () => {
    const node = new AlgaPsa();
    const context = createLoadOptionsHarness({
      requestHandler: () => ({ data: [{ board_id: 'board-1', board_name: 'Help Desk' }] }),
    });

    const result = await node.methods.listSearch.searchBoards.call(context, 'help');
    expect(result.results).toEqual([{ name: 'Help Desk', value: 'board-1' }]);
  });

  it('T038: status load-options maps API records to label/value list', async () => {
    const node = new AlgaPsa();
    const requestHandler = vi.fn(() => ({ data: [{ status_id: 'status-1', name: 'New' }] }));
    const context = createLoadOptionsHarness({
      requestHandler,
      currentNodeParameters: {
        resource: 'ticket',
        ticketOperation: 'create',
      },
    });

    const result = await node.methods.listSearch.searchStatuses.call(context, 'new');
    expect(result.results).toEqual([{ name: 'New', value: 'status-1' }]);
    expect(requestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.algapsa.test/api/v1/statuses',
        qs: expect.objectContaining({
          type: 'ticket',
          search: 'new',
        }),
      }),
    );
  });

  it('T039: priority load-options maps API records to label/value list', async () => {
    const node = new AlgaPsa();
    const context = createLoadOptionsHarness({
      requestHandler: () => ({ data: [{ priority_id: 'priority-1', priority_name: 'High' }] }),
    });

    const result = await node.methods.listSearch.searchPriorities.call(context, 'high');
    expect(result.results).toEqual([{ name: 'High', value: 'priority-1' }]);
  });

  it('T040: load-options failure returns empty list and required lookup fields keep manual ID mode', async () => {
    const node = new AlgaPsa();
    const context = createLoadOptionsHarness({
      requestHandler: () => {
        throw new Error('Lookup failed');
      },
    });

    const failedLookup = await node.methods.listSearch.searchClients.call(context, 'any');
    expect(failedLookup.results).toEqual([]);

    const createClientField = getProperty(node, 'client_id');
    const updateFieldCollection = getProperty(node, 'updateAdditionalFields').options ?? [];
    const updateClientField = updateFieldCollection.find((field) => field.name === 'client_id');

    const createModes = createClientField.modes?.map((mode) => mode.name);
    const updateModes = updateClientField?.modes?.map((mode) => mode.name);

    expect(createModes).toContain('id');
    expect(updateModes).toContain('id');
  });

  it('T041: ticket create/update required fields are separate from optional additional field groups', () => {
    const node = new AlgaPsa();

    const createAdditional = getProperty(node, 'createAdditionalFields');
    const updateAdditional = getProperty(node, 'updateAdditionalFields');
    const createRequiredNames = ['title', 'client_id', 'board_id', 'status_id', 'priority_id'];

    expect(createAdditional.type).toBe('collection');
    expect(updateAdditional.type).toBe('collection');

    for (const requiredName of createRequiredNames) {
      expect(() => getProperty(node, requiredName)).not.toThrow();
    }
  });

  it('T004: contact create keeps full_name as a required top-level field', () => {
    const node = new AlgaPsa();
    const fullName = getProperty(node, 'full_name');
    const createAdditional = getProperty(node, 'contactCreateAdditionalFields');
    const additionalNames = (createAdditional.options ?? []).map((field) => field.name);

    expect(fullName.required).toBe(true);
    expect(fullName.displayOptions?.show).toEqual({
      resource: ['contact'],
      contactOperation: ['create'],
    });
    expect(additionalNames).not.toContain('full_name');
  });

  it('T005: contact create additional fields expose the supported first-pass contact fields', () => {
    const node = new AlgaPsa();
    const createAdditional = getProperty(node, 'contactCreateAdditionalFields');
    const additionalNames = (createAdditional.options ?? []).map((field) => field.name);

    expect(additionalNames).toEqual([
      'email',
      'primary_email_canonical_type',
      'primary_email_custom_type',
      'additional_email_addresses',
      'client_id',
      'role',
      'notes',
      'is_inactive',
      'phone_numbers',
    ]);
  });

  it('T006: contact update additional fields expose the supported first-pass contact fields', () => {
    const node = new AlgaPsa();
    const updateAdditional = getProperty(node, 'contactUpdateAdditionalFields');
    const additionalNames = (updateAdditional.options ?? []).map((field) => field.name);

    expect(additionalNames).toEqual([
      'full_name',
      'email',
      'primary_email_canonical_type',
      'primary_email_custom_type',
      'additional_email_addresses',
      'client_id',
      'role',
      'notes',
      'is_inactive',
      'phone_numbers',
    ]);
  });

  it('T007: contactId is shown only for contact get, update, and delete operations', () => {
    const node = new AlgaPsa();
    const contactId = getProperty(node, 'contactId');

    expect(contactId.displayOptions?.show).toEqual({
      resource: ['contact'],
      contactOperation: ['get', 'update', 'delete'],
    });
  });

  it('T008: contact list inputs expose page, limit, and the agreed core filters', () => {
    const node = new AlgaPsa();
    const page = getProperty(node, 'contactPage');
    const limit = getProperty(node, 'contactLimit');
    const filters = getProperty(node, 'contactListFilters');
    const filterNames = (filters.options ?? []).map((field) => field.name);

    expect(page.displayName).toBe('Page');
    expect(limit.displayName).toBe('Limit');
    expect(filterNames).toEqual(['client_id', 'search_term', 'is_inactive']);
  });

  it('T009: contact create client_id supports both lookup and manual UUID entry', () => {
    const node = new AlgaPsa();
    const createAdditional = getProperty(node, 'contactCreateAdditionalFields');
    const clientField = (createAdditional.options ?? []).find((field) => field.name === 'client_id');
    const modes = clientField?.modes?.map((mode) => mode.name);

    expect(modes).toEqual(['list', 'id']);
    expect(clientField?.modes?.[0].typeOptions?.searchListMethod).toBe('searchClients');
  });

  it('T010: contact update client_id supports both lookup and manual UUID entry', () => {
    const node = new AlgaPsa();
    const updateAdditional = getProperty(node, 'contactUpdateAdditionalFields');
    const clientField = (updateAdditional.options ?? []).find((field) => field.name === 'client_id');
    const modes = clientField?.modes?.map((mode) => mode.name);

    expect(modes).toEqual(['list', 'id']);
    expect(clientField?.modes?.[0].typeOptions?.searchListMethod).toBe('searchClients');
  });

  it('T042: status helper exposes explicit status-type filter options', () => {
    const node = new AlgaPsa();
    const helperStatusType = getProperty(node, 'helperStatusType');
    const helperStatusTypeValues = helperStatusType.options?.map((option) => option.value);

    expect(helperStatusTypeValues).toEqual([
      'ticket',
      'project',
      'project_task',
      'interaction',
    ]);
  });

  it('T060: project task node subtitle includes the project task operation fallback', () => {
    const node = new AlgaPsa();
    expect(node.description.subtitle).toContain('$parameter["projectTaskOperation"]');
  });

  it('T061: project task create exposes required task_name, project, phase, and status mapping fields', () => {
    const node = new AlgaPsa();
    const taskName = getProperty(node, 'task_name');
    const projectId = getProperty(node, 'projectTaskProjectId');
    const phaseId = getProperty(node, 'projectTaskPhaseId');
    const statusMappingId = getProperty(node, 'projectTaskStatusMappingId');

    expect(taskName.required).toBe(true);
    expect(taskName.displayOptions?.show).toEqual({
      resource: ['projectTask'],
      projectTaskOperation: ['create'],
    });

    expect(projectId.required).toBe(true);
    expect(projectId.displayOptions?.show).toEqual({
      resource: ['projectTask'],
      projectTaskOperation: ['create', 'list'],
    });
    expect(projectId.modes?.[0].typeOptions?.searchListMethod).toBe('searchProjects');

    expect(phaseId.required).toBe(true);
    expect(phaseId.displayOptions?.show).toEqual({
      resource: ['projectTask'],
      projectTaskOperation: ['create'],
    });
    expect(phaseId.modes?.[0].typeOptions?.searchListMethod).toBe('searchProjectPhases');

    expect(statusMappingId.required).toBe(true);
    expect(statusMappingId.modes?.[0].typeOptions?.searchListMethod).toBe(
      'searchProjectTaskStatusMappings',
    );
  });

  it('T062: project task create/update additional fields expose the supported scalar fields', () => {
    const node = new AlgaPsa();
    const createAdditional = getProperty(node, 'projectTaskCreateAdditionalFields');
    const updateAdditional = getProperty(node, 'projectTaskUpdateAdditionalFields');

    const createNames = (createAdditional.options ?? []).map((field) => field.name);
    const updateNames = (updateAdditional.options ?? []).map((field) => field.name);

    expect(createNames).toEqual([
      'description',
      'assigned_to',
      'estimated_hours',
      'due_date',
      'priority_id',
      'task_type_key',
      'wbs_code',
      'tags',
    ]);

    expect(updateNames).toEqual([
      'task_name',
      'description',
      'assigned_to',
      'estimated_hours',
      'due_date',
      'priority_id',
      'task_type_key',
      'project_status_mapping_id',
      'wbs_code',
      'tags',
    ]);
  });

  it('T063: project task ID field is shown only for get, update, and delete operations', () => {
    const node = new AlgaPsa();
    const taskId = getProperty(node, 'projectTaskId');

    expect(taskId.required).toBe(true);
    expect(taskId.displayOptions?.show).toEqual({
      resource: ['projectTask'],
      projectTaskOperation: ['get', 'update', 'delete'],
    });
  });

  it('T064: project task list inputs expose project, page, and limit', () => {
    const node = new AlgaPsa();
    const page = getProperty(node, 'projectTaskPage');
    const limit = getProperty(node, 'projectTaskLimit');

    expect(page.displayOptions?.show).toEqual({
      resource: ['projectTask'],
      projectTaskOperation: ['list'],
    });
    expect(limit.displayOptions?.show).toEqual({
      resource: ['projectTask'],
      projectTaskOperation: ['list'],
    });
  });

  it('T065: projects load-options maps API records to label/value list', async () => {
    const node = new AlgaPsa();
    const context = createLoadOptionsHarness({
      requestHandler: () => ({
        data: [{ project_id: 'proj-1', project_name: 'Website Rebuild' }],
      }),
    });

    const result = await node.methods.listSearch.searchProjects.call(context, 'web');
    expect(result.results).toEqual([{ name: 'Website Rebuild', value: 'proj-1' }]);
  });

  it('T066: project phases load-options scopes to the selected project via URL path', async () => {
    const node = new AlgaPsa();
    const requestHandler = vi.fn(() => ({
      data: [{ phase_id: 'phase-1', phase_name: 'Discovery' }],
    }));

    const context = createLoadOptionsHarness({
      requestHandler,
      currentNodeParameters: {
        resource: 'projectTask',
        projectTaskOperation: 'create',
        projectTaskProjectId: {
          mode: 'id',
          value: '00000000-0000-0000-0000-000000000201',
        },
      },
    });

    const result = await node.methods.listSearch.searchProjectPhases.call(context, 'disc');
    expect(result.results).toEqual([{ name: 'Discovery', value: 'phase-1' }]);
    expect(requestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        url:
          'https://api.algapsa.test/api/v1/projects/00000000-0000-0000-0000-000000000201/phases',
      }),
    );
  });

  it('T067: project phases load-options returns empty list when no project is selected', async () => {
    const node = new AlgaPsa();
    const requestHandler = vi.fn(() => ({ data: [] }));
    const context = createLoadOptionsHarness({
      requestHandler,
      currentNodeParameters: {
        resource: 'projectTask',
        projectTaskOperation: 'create',
      },
    });

    const result = await node.methods.listSearch.searchProjectPhases.call(context, 'any');
    expect(result.results).toEqual([]);
    expect(requestHandler).not.toHaveBeenCalled();
  });

  it('T068: project task status mappings load-options scopes to project and maps labels', async () => {
    const node = new AlgaPsa();
    const requestHandler = vi.fn(() => ({
      data: [
        {
          project_status_mapping_id: 'mapping-1',
          custom_name: 'In Progress',
          status_name: 'In Progress',
          name: 'In Progress',
        },
      ],
    }));

    const context = createLoadOptionsHarness({
      requestHandler,
      currentNodeParameters: {
        resource: 'projectTask',
        projectTaskOperation: 'create',
        projectTaskProjectId: {
          mode: 'id',
          value: '00000000-0000-0000-0000-000000000202',
        },
      },
    });

    const result = await node.methods.listSearch.searchProjectTaskStatusMappings.call(
      context,
      'progress',
    );
    expect(result.results).toEqual([{ name: 'In Progress', value: 'mapping-1' }]);
    expect(requestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        url:
          'https://api.algapsa.test/api/v1/projects/00000000-0000-0000-0000-000000000202/task-status-mappings',
      }),
    );
  });
});
