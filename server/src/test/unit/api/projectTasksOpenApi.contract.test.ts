import { describe, expect, it } from 'vitest';

import { generateBaseDocument } from '@/lib/api/openapi';
import { createProjectTaskSchema, updateProjectTaskSchema } from '@/lib/api/schemas/project';

describe('project task OpenAPI contracts', () => {
  it('adds product availability metadata to OpenAPI operations', () => {
    const document = generateBaseDocument({
      title: 'AlgaPSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ee',
    });

    expect(document.paths?.['/api/v1/tickets']?.get?.['x-alga-products']).toEqual(['psa', 'algadesk']);
    expect(document.paths?.['/api/v1/projects']?.get?.['x-alga-products']).toEqual(['psa']);
    expect(document.paths?.['/api/v1/tickets/{id}/time-entries']?.get?.['x-alga-products']).toEqual(['psa']);
  });

  it('documents UUID path parameters for project task routes instead of placeholder backfill metadata', () => {
    const document = generateBaseDocument({
      title: 'AlgaPSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ee',
    });

    const listTasksOperation = document.paths?.['/api/v1/projects/{id}/tasks']?.get as
      | Record<string, any>
      | undefined;
    const statusMappingsOperation = document.paths?.['/api/v1/projects/{id}/task-status-mappings']
      ?.get as Record<string, any> | undefined;
    const phaseTasksOperation = document.paths?.['/api/v1/projects/{id}/phases/{phaseId}/tasks']
      ?.get as Record<string, any> | undefined;
    const taskOperation = document.paths?.['/api/v1/projects/tasks/{taskId}']?.get as
      | Record<string, any>
      | undefined;
    const updateTaskOperation = document.paths?.['/api/v1/projects/tasks/{taskId}']?.put as
      | Record<string, any>
      | undefined;

    expect(statusMappingsOperation?.description).toContain('translate a human-readable status label');
    expect(statusMappingsOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'id',
          in: 'path',
          required: true,
          schema: expect.objectContaining({
            type: 'string',
            format: 'uuid',
          }),
        }),
      ]),
    );
    expect(listTasksOperation?.description).toContain('Returns all tasks for the specified project UUID');
    expect(listTasksOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'id',
          in: 'path',
          required: true,
          schema: expect.objectContaining({
            type: 'string',
            format: 'uuid',
          }),
        }),
      ]),
    );
    expect(phaseTasksOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
        expect.objectContaining({ name: 'phaseId', in: 'path', required: true }),
      ]),
    );
    expect(taskOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'taskId', in: 'path', required: true }),
      ]),
    );
    expect(updateTaskOperation?.requestBody).toBeTruthy();
  });

  it('accepts and documents the task start date alongside the due date', () => {
    const start_date = '2026-10-05T00:00:00.000Z';
    const due_date = '2026-10-09T00:00:00.000Z';

    expect(
      createProjectTaskSchema.parse({
        task_name: 'Dated task',
        project_status_mapping_id: '11111111-1111-4111-8111-111111111111',
        start_date,
        due_date,
      }),
    ).toMatchObject({ start_date, due_date });
    expect(updateProjectTaskSchema.parse({ start_date })).toEqual({ start_date });
    expect(() => updateProjectTaskSchema.parse({ start_date: 'next week' })).toThrow();

    const document = generateBaseDocument({
      title: 'AlgaPSA API',
      version: '0.1.0-test',
      description: 'Test document',
      edition: 'ee',
    });
    const schemas = (document.components?.schemas ?? {}) as Record<string, any>;

    for (const name of ['ProjectTaskCreateRequest', 'ProjectTaskUpdateRequest', 'ProjectTaskApiResponse']) {
      expect(Object.keys(schemas[name]?.properties ?? {}), name).toEqual(
        expect.arrayContaining(['start_date', 'due_date']),
      );
    }
  });
});
