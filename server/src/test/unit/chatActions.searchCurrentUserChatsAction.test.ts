import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const searchByUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@ee/models/chat', () => ({
  __esModule: true,
  default: {
    searchByUser: searchByUserMock,
  },
}));

describe('searchCurrentUserChatsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('fails closed when chat persistence is unavailable', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: {
        schema: {
          hasTable: vi.fn(async () => false),
        },
      },
    });

    const { searchCurrentUserChatsAction } = await import('@ee/lib/chat-actions/chatActions');
    const rows = await searchCurrentUserChatsAction('printer');

    expect(rows).toEqual([]);
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(searchByUserMock).not.toHaveBeenCalled();
  });

  it('fails closed when search columns are missing during rollout', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: {
        schema: {
          hasTable: vi.fn(async () => true),
        },
      },
    });
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });
    searchByUserMock.mockRejectedValue({ code: '42703' });

    const { searchCurrentUserChatsAction } = await import('@ee/lib/chat-actions/chatActions');
    const rows = await searchCurrentUserChatsAction('printer');

    expect(rows).toEqual([]);
    expect(searchByUserMock).toHaveBeenCalledWith('user-1', 'printer', 20);
  });
});
