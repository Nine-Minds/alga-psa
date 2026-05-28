import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
  writeEntityMapping: vi.fn(),
  addTask: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@alga-psa/shared/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
  writeEntityMapping: mocks.writeEntityMapping,
}));

vi.mock('@alga-psa/projects/models/projectTask', () => ({
  default: {
    addTask: mocks.addTask,
    updateTaskStatus: mocks.updateTaskStatus,
  },
}));

async function loadProjectInboundActions() {
  vi.resetModules();
  await import('@alga-psa/projects/actions/inboundActions');
  return import('@alga-psa/shared/inboundWebhooks/actions/registry');
}

function createQuery(firstValue: unknown) {
  return {
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstValue),
  };
}

describe('project task inbound webhook actions', () => {
  const tenantKnex = { name: 'tenant-knex' };
  let trx: ReturnType<typeof vi.fn>;
  let projectQuery: ReturnType<typeof createQuery>;
  let phaseQuery: ReturnType<typeof createQuery>;
  let statusMappingQuery: ReturnType<typeof createQuery>;
  let taskLookupQuery: ReturnType<typeof createQuery> & { join: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    projectQuery = createQuery({ project_id: 'project-1' });
    phaseQuery = createQuery({ phase_id: 'phase-1' });
    statusMappingQuery = createQuery({ project_status_mapping_id: 'status-1' });
    taskLookupQuery = {
      ...createQuery({
        task_id: 'task-1',
        phase_id: 'phase-1',
        project_id: 'project-1',
      }),
      join: vi.fn().mockReturnThis(),
    };
    trx = vi.fn((table: string) => {
      if (table === 'projects') {
        return projectQuery;
      }
      if (table === 'project_phases') {
        return phaseQuery;
      }
      if (table === 'project_status_mappings') {
        return statusMappingQuery;
      }
      if (table === 'project_tasks as pt') {
        return taskLookupQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createTenantKnex.mockResolvedValue({ knex: tenantKnex });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (transaction: unknown) => unknown) =>
      callback(trx),
    );
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'project-1',
      externalEntityId: 'ext-project-1',
      metadata: {},
    });
    mocks.addTask.mockResolvedValue({
      task_id: 'task-1',
      phase_id: 'phase-1',
      project_status_mapping_id: 'status-1',
    });
    mocks.updateTaskStatus.mockResolvedValue({
      task_id: 'task-1',
      phase_id: 'phase-1',
      project_status_mapping_id: 'status-2',
    });
  });

  it('T1070: createProjectTask creates a task under a project resolved by external ID', async () => {
    const { getAction } = await loadProjectInboundActions();
    const action = getAction('createProjectTask');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'project-feed',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { task: { id: 'ext-task-1' } },
          idempotencyKey: 'ext-task-1',
        },
        {
          project_external_id: 'ext-project-1',
          phase_id: 'phase-1',
          project_status_mapping_id: 'status-1',
          task_name: 'Replace firewall',
          description: 'Cutover task from external PM system',
          assigned_to: 'user-1',
          estimated_hours: 4,
          due_date: '2026-05-18T00:00:00.000Z',
          priority_id: 'priority-1',
          task_type_key: 'implementation',
          service_id: 'service-1',
          external_id: 'ext-task-1',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'project_task',
      entityId: 'task-1',
      externalId: 'ext-task-1',
      metadata: {
        phase_id: 'phase-1',
        project_status_mapping_id: 'status-1',
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'project-feed',
      'project',
      'ext-project-1',
      { knex: trx },
    );
    expect(projectQuery.where).toHaveBeenCalledWith({ tenant: 'tenant-a', project_id: 'project-1' });
    expect(phaseQuery.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      project_id: 'project-1',
      phase_id: 'phase-1',
    });
    expect(statusMappingQuery.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      project_status_mapping_id: 'status-1',
    });
    expect(mocks.addTask).toHaveBeenCalledWith(
      trx,
      'tenant-a',
      'phase-1',
      {
        task_name: 'Replace firewall',
        description: 'Cutover task from external PM system',
        assigned_to: 'user-1',
        estimated_hours: 4,
        actual_hours: null,
        due_date: new Date('2026-05-18T00:00:00.000Z'),
        project_status_mapping_id: 'status-1',
        priority_id: 'priority-1',
        task_type_key: 'implementation',
        service_id: 'service-1',
      },
    );
    expect(mocks.writeEntityMapping).toHaveBeenCalledWith(
      'tenant-a',
      'project-feed',
      'project_task',
      'task-1',
      'ext-task-1',
      {
        knex: trx,
        metadata: {
          source: 'inbound_webhook',
          delivery_id: 'delivery-1',
        },
      },
    );
  });

  it('T1071: updateProjectTaskStatusByExternalId resolves a mapped task and updates status', async () => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'task-1',
      externalEntityId: 'ext-task-1',
      metadata: {},
    });
    statusMappingQuery.first.mockResolvedValueOnce({ project_status_mapping_id: 'status-2' });
    const { getAction } = await loadProjectInboundActions();
    const action = getAction('updateProjectTaskStatusByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'project-feed',
          deliveryId: 'delivery-2',
          headers: {},
          rawBody: { task: { id: 'ext-task-1', status: 'blocked' } },
          idempotencyKey: 'ext-task-1:status',
        },
        {
          external_id: 'ext-task-1',
          project_status_mapping_id: 'status-2',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'project_task',
      entityId: 'task-1',
      externalId: 'ext-task-1',
      metadata: {
        project_status_mapping_id: 'status-2',
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'project-feed',
      'project_task',
      'ext-task-1',
      { knex: trx },
    );
    expect(taskLookupQuery.join).toHaveBeenCalledWith('project_phases as pp', expect.any(Function));
    expect(taskLookupQuery.where).toHaveBeenCalledWith({ 'pt.tenant': 'tenant-a', 'pt.task_id': 'task-1' });
    expect(statusMappingQuery.where).toHaveBeenCalledWith({
      tenant: 'tenant-a',
      project_status_mapping_id: 'status-2',
    });
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(trx, 'tenant-a', 'task-1', 'status-2');
  });
});
