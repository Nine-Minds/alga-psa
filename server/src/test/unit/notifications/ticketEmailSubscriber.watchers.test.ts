import { describe, expect, it, vi } from 'vitest';
import {
  extractActiveWatcherEmails,
  sendOneEmailPerWatcher,
} from '../../../lib/eventBus/subscribers/watcherRecipients';

describe('ticketEmailSubscriber watcher behavior', () => {
  it('T027: active watcher extraction ignores inactive and invalid entries, normalizes, and dedupes', () => {
    const emails = extractActiveWatcherEmails({
      watch_list: [
        { email: 'active@example.com', active: true },
        { email: 'ACTIVE@EXAMPLE.COM', active: true },
        { email: 'inactive@example.com', active: false },
        { email: '  mixedcase@example.com  ', active: true },
        { email: 'not-an-email', active: true },
      ],
    });

    expect(emails).toEqual(['active@example.com', 'mixedcase@example.com']);
  });

  it('T028: active watcher extraction preserves active status when duplicate entries conflict', () => {
    const emails = extractActiveWatcherEmails({
      watch_list: [
        { email: 'reactivate@example.com', active: false },
        { email: 'REACTIVATE@example.com', active: true },
      ],
    });

    expect(emails).toEqual(['reactivate@example.com']);
  });

  it('T036: watcher send helper dedupes case-insensitively and excludes explicit recipients', async () => {
    const sendFn = vi.fn(async () => undefined);
    const excluded = new Set<string>(['primary@example.com']);

    await sendOneEmailPerWatcher(
      [
        'primary@example.com',
        'watcher@example.com',
        'WATCHER@EXAMPLE.COM',
        'secondary@example.com',
      ],
      sendFn,
      { excludeEmails: excluded }
    );

    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(sendFn).toHaveBeenNthCalledWith(1, 'watcher@example.com');
    expect(sendFn).toHaveBeenNthCalledWith(2, 'secondary@example.com');
  });

  it('T038: watcher send helper drops invalid emails and trims valid recipients', async () => {
    const sendFn = vi.fn(async () => undefined);

    await sendOneEmailPerWatcher(['  valid@example.com  ', 'not-an-email', '   '], sendFn);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith('valid@example.com');
  });

  it('T039: watcher send helper issues one send operation per watcher (no aggregated CC behavior)', async () => {
    const sendFn = vi.fn(async () => undefined);

    await sendOneEmailPerWatcher(['one@example.com', 'two@example.com', 'three@example.com'], sendFn);

    expect(sendFn).toHaveBeenCalledTimes(3);
    expect(sendFn.mock.calls.map((call) => call[0])).toEqual([
      'one@example.com',
      'two@example.com',
      'three@example.com',
    ]);
  });

  it('T062: watcher recipient extraction/sending remains email-driven when entity metadata is present', async () => {
    const emails = extractActiveWatcherEmails({
      watch_list: [
        {
          email: 'user-linked@example.com',
          active: true,
          entity_type: 'user',
          entity_id: 'user-1',
          name: 'Linked User',
        },
        {
          email: 'contact-linked@example.com',
          active: true,
          entity_type: 'contact',
          entity_id: 'contact-2',
          name: 'Linked Contact',
        },
      ],
    });

    const sendFn = vi.fn(async () => undefined);
    await sendOneEmailPerWatcher(emails, sendFn);

    expect(sendFn.mock.calls.map((call) => call[0])).toEqual([
      'user-linked@example.com',
      'contact-linked@example.com',
    ]);
  });

  it('T063: watcher with linked inactive/deleted identity metadata still sends when watcher is active', async () => {
    const emails = extractActiveWatcherEmails({
      watch_list: [
        {
          email: 'still-send@example.com',
          active: true,
          entity_type: 'user',
          entity_id: 'user-inactive',
          entity_is_inactive: true,
        } as any,
      ],
    });

    const sendFn = vi.fn(async () => undefined);
    await sendOneEmailPerWatcher(emails, sendFn);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith('still-send@example.com');
  });
});
