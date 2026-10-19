import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The REST board endpoints delete and update boards directly, bypassing the
 * co-management checks the app's board actions apply: an API client could
 * remove an MSP escalation queue or a board shared with the MSP.
 */
const mocks = vi.hoisted(() => ({ escalations: vi.fn(async () => 0), scopes: vi.fn(async () => 0) }));
vi.mock('@alga-psa/core/config/deletion', () => ({
  countLiveCoManagedEscalationsForBoard: mocks.escalations,
  countCoManagedBoardScopes: mocks.scopes,
}));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(async () => undefined) }));

import { BaseService } from '@alga-psa/db';
import { BoardService } from '../../../lib/api/services/BoardService';

const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

describe('BoardService co-management guard', () => {
  let service: BoardService;
  let deleteSpy: ReturnType<typeof vi.spyOn>;
  let updateSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new BoardService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    deleteSpy = vi.spyOn(BaseService.prototype as any, 'delete').mockResolvedValue(undefined);
    updateSpy = vi.spyOn(BaseService.prototype as any, 'update').mockResolvedValue({ board_id: 'b' });
  });

  it('refuses to delete an escalation queue a live co-managed workspace uses', async () => {
    mocks.escalations.mockResolvedValueOnce(1);
    await expect(service.delete('b', context)).rejects.toMatchObject({ statusCode: 409 });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('refuses to deactivate a board shared with the MSP, but allows other edits', async () => {
    mocks.scopes.mockResolvedValueOnce(1);
    await expect(service.update('b', { is_inactive: true } as any, context)).rejects.toMatchObject({ statusCode: 409 });
    expect(updateSpy).not.toHaveBeenCalled();
    mocks.scopes.mockResolvedValue(1);
    await expect(service.update('b', { board_name: 'Renamed' } as any, context)).resolves.toBeTruthy();
  });

  it('deletes a board nothing co-managed depends on', async () => {
    await service.delete('b', context);
    expect(deleteSpy).toHaveBeenCalled();
  });
});
