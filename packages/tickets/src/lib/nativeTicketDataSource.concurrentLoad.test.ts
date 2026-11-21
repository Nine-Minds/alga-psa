import { describe, expect, it, vi } from 'vitest';

// Kept in its own file so the action modules below are still unloaded when the calls start: the case under test
// is several calls arriving while a module's first import is in flight (two ticket screens mounting together).
const getTicketStatuses = vi.hoisted(() => vi.fn(async () => ['statuses']));
const getAllPriorities = vi.hoisted(() => vi.fn(async () => ['priorities']));
const getTicketCategoriesByBoard = vi.hoisted(() => vi.fn(async () => ({ categories: [] })));

vi.mock('@alga-psa/reference-data/actions', () => ({ getTicketStatuses, getAllPriorities }));
vi.mock('../actions/ticketCategoryActions', () => ({ getTicketCategoriesByBoard }));

import { nativeTicketDataSource } from './nativeTicketDataSource';

describe('native data source: calls made while an action module is still loading', () => {
  it('all reach the mocked action, never the real module, whether they share a method or only its module', async () => {
    const { options } = nativeTicketDataSource;

    const results = await Promise.all([
      options.getTicketStatuses(),
      options.getTicketStatuses(),
      options.getAllPriorities(),
      options.getTicketCategoriesByBoard('board-a'),
      options.getTicketCategoriesByBoard('board-b'),
    ]);

    expect(results).toEqual([
      ['statuses'],
      ['statuses'],
      ['priorities'],
      { categories: [] },
      { categories: [] },
    ]);
    expect(getTicketStatuses).toHaveBeenCalledTimes(2);
    expect(getAllPriorities).toHaveBeenCalledTimes(1);
    expect(getTicketCategoriesByBoard).toHaveBeenNthCalledWith(1, 'board-a');
    expect(getTicketCategoriesByBoard).toHaveBeenNthCalledWith(2, 'board-b');
  });

  it('reads the export again on a later call, so a mock changed between calls is honoured', async () => {
    getTicketStatuses.mockResolvedValueOnce(['changed']);
    await expect(nativeTicketDataSource.options.getTicketStatuses()).resolves.toEqual(['changed']);
  });
});
