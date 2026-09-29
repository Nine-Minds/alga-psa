import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));
import { ApiBaseController, type AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';
import { boardListQuerySchema } from '../../../lib/api/schemas/board';
import { paginationQuerySchema } from '../../../lib/api/schemas/common';

class ListController extends ApiBaseController {
  protected async authenticate(req: NextRequest) { return Object.assign(req, { context: { tenant: 'test-tenant' } }) as AuthenticatedApiRequest; }
  protected async checkPermission() {}
  protected async runWithApiKeyContext<T>(_req: AuthenticatedApiRequest, callback: () => Promise<T>): Promise<T> { return callback(); }
}

it('honors board query defaults and explicit ordering while preserving generic list defaults', async () => {
  const list = vi.fn(async (options: { sort: string; order: string }) => ({
    data: [...[{ display_order: 10 }, { display_order: 1 }]].sort((a, b) =>
      (a.display_order - b.display_order) * (options.order === 'asc' ? 1 : -1)), total: 2,
  }));
  const boards = new ListController({ list } as any, { resource: 'board', querySchema: boardListQuerySchema } as any);
  const response = await boards.list()(new NextRequest('http://localhost/api/v1/boards'));
  expect(response.status).toBe(200);
  expect((await response.json()).data.map((board: { display_order: number }) => board.display_order)).toEqual([1, 10]);
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'display_order', order: 'asc' }), expect.anything());

  await boards.list()(new NextRequest('http://localhost/api/v1/boards?sort=board_name&order=desc'));
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'board_name', order: 'desc' }), expect.anything());

  const generic = new ListController({ list } as any, { resource: 'item', querySchema: paginationQuerySchema } as any);
  await generic.list()(new NextRequest('http://localhost/api/v1/items'));
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'created_at', order: 'desc' }), expect.anything());
});
