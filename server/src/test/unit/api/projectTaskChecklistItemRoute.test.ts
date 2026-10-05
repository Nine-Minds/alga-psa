import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

vi.mock('../../../lib/db', () => ({
  runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
}));

import { ApiProjectController } from '../../../lib/api/controllers/ApiProjectController';
import type { AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';
import { createTaskChecklistItemSchema, updateTaskChecklistItemSchema } from '../../../lib/api/schemas/project';

const taskId = '00000000-0000-4000-8000-000000000001';
const itemId = '00000000-0000-4000-8000-000000000002';

class ChecklistController extends ApiProjectController {
  constructor(projectService: Record<string, unknown>) {
    super();
    (this as any).projectService = projectService;
  }

  // The checklist routes authenticate inline; stub that whole step.
  protected async authenticateChecklistWrite(req: NextRequest) {
    const apiRequest = Object.assign(req, { context: { tenant: 'test-tenant', userId: 'user-1' } }) as AuthenticatedApiRequest;
    return { apiRequest, tenantId: 'test-tenant', knex: {} as never };
  }

  protected async assertTaskProjectAllowed() {}
}

function request(method: 'PUT' | 'DELETE', body?: Record<string, unknown>, ids = { taskId, itemId }) {
  return new NextRequest(`http://localhost/api/v1/projects/tasks/${ids.taskId}/checklist/${ids.itemId}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('checklist item schemas', () => {
  it('normalise the legacy item_text / is_completed spellings to the table columns', () => {
    expect(createTaskChecklistItemSchema.parse({ item_text: 'Label the rack', is_completed: true })).toEqual({ item_name: 'Label the rack', completed: true });
    expect(createTaskChecklistItemSchema.parse({ item_name: 'Label the rack' })).toEqual({ item_name: 'Label the rack', completed: false });
    expect(createTaskChecklistItemSchema.safeParse({ description: 'no name' }).success).toBe(false);
    expect(updateTaskChecklistItemSchema.parse({ completed: true })).toEqual({ completed: true });
    expect(updateTaskChecklistItemSchema.parse({ is_completed: false, item_text: 'Renamed' })).toEqual({ completed: false, item_name: 'Renamed' });
  });
});

describe('PUT /api/v1/projects/tasks/{taskId}/checklist/{itemId}', () => {
  it('ticks the item done through the service', async () => {
    const updateChecklistItem = vi.fn().mockResolvedValue({ checklist_item_id: itemId, task_id: taskId, item_name: 'Label the rack', completed: true });
    const controller = new ChecklistController({ updateChecklistItem });

    const response = await controller.updateChecklistItem()(request('PUT', { completed: true, mystery: 1 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { checklist_item_id: itemId, task_id: taskId, item_name: 'Label the rack', completed: true } });
    expect(updateChecklistItem).toHaveBeenCalledWith(taskId, itemId, { completed: true }, expect.objectContaining({ tenant: 'test-tenant' }));
  });

  it('rejects a malformed item id before touching the service', async () => {
    const updateChecklistItem = vi.fn();
    const controller = new ChecklistController({ updateChecklistItem });

    const response = await controller.updateChecklistItem()(request('PUT', { completed: true }, { taskId, itemId: 'nope' }));

    expect(response.status).toBe(400);
    expect(updateChecklistItem).not.toHaveBeenCalled();
  });

  it('answers 404 when the item is not on the task', async () => {
    const { NotFoundError } = await import('../../../lib/api/middleware/apiMiddleware');
    const updateChecklistItem = vi.fn().mockRejectedValue(new NotFoundError('Checklist item not found'));
    const controller = new ChecklistController({ updateChecklistItem });

    const response = await controller.updateChecklistItem()(request('PUT', { completed: true }));

    expect(response.status).toBe(404);
  });

  it('deletes the item and answers 204', async () => {
    const deleteChecklistItem = vi.fn().mockResolvedValue(undefined);
    const controller = new ChecklistController({ deleteChecklistItem });

    const response = await controller.deleteChecklistItem()(request('DELETE'));

    expect(response.status).toBe(204);
    expect(deleteChecklistItem).toHaveBeenCalledWith(taskId, itemId, expect.objectContaining({ tenant: 'test-tenant' }));
  });
});
