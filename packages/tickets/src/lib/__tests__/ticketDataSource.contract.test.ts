import { describe, expect, it, vi } from 'vitest';

const getTicketById = vi.fn().mockResolvedValue({ ticket_id: 't1' });
const getTicketChecklistItems = vi.fn().mockResolvedValue([]);
vi.mock('../../actions/ticketActions', () => ({ getTicketById }));
vi.mock('../../actions/checklists/ticketChecklistActions', () => ({ getTicketChecklistItems }));

import { nativeTicketDataSource } from '../nativeTicketDataSource';
import {
  NATIVE_TICKET_CAPABILITIES,
  NO_TICKET_CAPABILITIES,
  TICKET_WRITE_ACTION_CAPABILITIES,
  composeTicketDataSource,
  resolveTicketTimeWorkItem,
} from '../ticketDataSource';

const METHOD_GROUPS = [
  'ticket', 'comments', 'people', 'resources', 'watchers', 'options', 'closeRules', 'bundles',
  'checklist', 'externalLinks', 'activity', 'email', 'materials', 'tiles', 'tags', 'avatars',
  'viewer',
] as const;

describe('native ticket data source contract', () => {
  it('is a frozen native singleton with no overrides', () => {
    expect(Object.isFrozen(nativeTicketDataSource)).toBe(true);
    expect(nativeTicketDataSource.kind).toBe('native');
    expect(nativeTicketDataSource.capabilities).toEqual(NATIVE_TICKET_CAPABILITIES);
    expect(Object.values(nativeTicketDataSource.capabilities).every(Boolean)).toBe(true);
    expect(nativeTicketDataSource.screen).toEqual({});
    expect(nativeTicketDataSource.conversation).toEqual({});
    expect(nativeTicketDataSource.slots).toEqual({});
    expect(nativeTicketDataSource.time).toEqual({});
    expect('boundTicketId' in nativeTicketDataSource).toBe(false);
  });

  it('declares 26 capabilities and the seventeen method groups, every method a function', () => {
    expect(Object.keys(NATIVE_TICKET_CAPABILITIES)).toHaveLength(26);
    expect(Object.keys(NO_TICKET_CAPABILITIES)).toEqual(Object.keys(NATIVE_TICKET_CAPABILITIES));
    let methods = 0;
    for (const group of METHOD_GROUPS) {
      const entries = Object.entries(nativeTicketDataSource[group] as unknown as Record<string, unknown>);
      expect(entries.length, group).toBeGreaterThan(0);
      for (const [name, fn] of entries) {
        expect(typeof fn, `${group}.${name}`).toBe('function');
        methods += 1;
      }
    }
    expect(methods).toBe(97);
  });

  it('forwards arguments and results unchanged, resolving the action at call time', async () => {
    await expect(nativeTicketDataSource.ticket.getTicketById('t1')).resolves.toEqual({ ticket_id: 't1' });
    expect(getTicketById).toHaveBeenCalledWith('t1');
    await nativeTicketDataSource.checklist.getTicketChecklistItems('t1');
    expect(getTicketChecklistItems).toHaveBeenCalledWith('t1');
  });

  it('composes one level deep and switches write capabilities off for a read-only screen', () => {
    const composed = composeTicketDataSource(nativeTicketDataSource, {
      kind: 'other',
      screen: { readOnly: true },
      capabilities: { sla: false },
    });
    expect(composed.kind).toBe('other');
    expect(composed.capabilities.sla).toBe(false);
    for (const key of TICKET_WRITE_ACTION_CAPABILITIES) expect(composed.capabilities[key], key).toBe(false);
    expect(composed.ticket).toBe(nativeTicketDataSource.ticket);
  });

  it('resolves the native time work item to the ticket itself', () => {
    expect(resolveTicketTimeWorkItem(nativeTicketDataSource, { ticket_id: 't1' })).toEqual({
      workItemType: 'ticket',
      workItemId: 't1',
    });
  });
});
