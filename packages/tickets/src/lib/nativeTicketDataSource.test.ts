import { describe, expect, it, vi } from 'vitest';

const getTicketById = vi.fn().mockResolvedValue({ ticket_id: 't1' });
const updateTicket = vi.fn().mockResolvedValue({ ok: true });
const findCommentsByTicketId = vi.fn().mockResolvedValue([]);
const partyTags = { contact: [], client: [] };
const getTicketPartyDisplayTags = vi.fn().mockResolvedValue(partyTags);

vi.mock('../actions/ticketActions', () => ({ getTicketById, updateTicket }));
vi.mock('../actions/comment-actions/commentActions', () => ({ findCommentsByTicketId }));
vi.mock('../actions/optimizedTicketActions', () => ({ getTicketPartyDisplayTags }));

import { nativeTicketDataSource } from './nativeTicketDataSource';

describe('T001 native default data source', () => {
  it('makes no action calls on import or construction', () => {
    expect(getTicketById).not.toHaveBeenCalled();
    expect(updateTicket).not.toHaveBeenCalled();
    expect(findCommentsByTicketId).not.toHaveBeenCalled();
    expect(getTicketPartyDisplayTags).not.toHaveBeenCalled();
  });

  it('forwards party tag requests through the native action', async () => {
    await expect(nativeTicketDataSource.tags.getTicketPartyDisplayTags('t1', 'contact-1', null))
      .resolves.toBe(partyTags);
    expect(getTicketPartyDisplayTags).toHaveBeenCalledExactlyOnceWith('t1', 'contact-1', null);
  });

  it('forwards to the same actions with byte-identical arguments and results', async () => {
    const data = { title: 'x' };
    await expect(nativeTicketDataSource.ticket.getTicketById('t1')).resolves.toEqual({ ticket_id: 't1' });
    expect(getTicketById).toHaveBeenCalledTimes(1);
    expect(getTicketById).toHaveBeenCalledWith('t1');
    await nativeTicketDataSource.ticket.updateTicket('t1', data as never);
    expect(updateTicket).toHaveBeenCalledWith('t1', data);
    await nativeTicketDataSource.comments.findCommentsByTicketId('t1');
    expect(findCommentsByTicketId).toHaveBeenCalledWith('t1');
  });

  it('is a frozen singleton with every capability on and no overrides', () => {
    expect(Object.isFrozen(nativeTicketDataSource)).toBe(true);
    expect(nativeTicketDataSource.kind).toBe('native');
    expect(Object.values(nativeTicketDataSource.capabilities).every(Boolean)).toBe(true);
    expect(nativeTicketDataSource.screen).toEqual({});
    expect(nativeTicketDataSource.conversation).toEqual({});
    expect(nativeTicketDataSource.slots).toEqual({});
    expect(nativeTicketDataSource.time).toEqual({});
  });
});
