import { describe, expect, it } from 'vitest';

import { generateBaseDocument } from '@/lib/api/openapi';

describe('project task OpenAPI contracts', () => {
  it('documents UUID path parameters for project task routes instead of placeholder backfill metadata', () => {
    const document = generateBaseDocument({
      title: 'Alga PSA API',
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
});
