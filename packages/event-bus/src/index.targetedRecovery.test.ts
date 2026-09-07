import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const redis = vi.hoisted(() => ({ on: vi.fn(), connect: vi.fn().mockResolvedValue(undefined), xGroupCreate: vi.fn().mockResolvedValue(undefined),
  xAdd: vi.fn().mockResolvedValue('1-0'), xAck: vi.fn().mockResolvedValue(1), sIsMember: vi.fn().mockResolvedValue(true),
  sAdd: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) }));
vi.mock('redis', () => ({ createClient: () => redis }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: async () => null }));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { EventBus } from './eventBus';
import { publishEvent } from './publishers';
import { getRedisConfig } from './config/redisConfig';
const event = () => ({ id: randomUUID(), timestamp: new Date().toISOString(), eventType: 'CUSTOM_EVENT', payload: { tenantId: randomUUID() } });
beforeEach(() => { vi.clearAllMocks(); });

it('publishes targeted recovery only to its channel and omits workflow and notification fanout', async () => {
  const input = { ...event(), eventType: 'TICKET_COMMENT_ADDED', payload: { tenantId: randomUUID(), ticketId: randomUUID(), userId: randomUUID(), comment: { id: randomUUID(), content: 'Replay', author: 'Technician' } } };
  await publishEvent({ eventType: input.eventType, payload: input.payload } as any, { channel: 'global', eventId: input.id, strict: true, force: true, targetSubscriber: 'search-index' });
  expect(redis.xAdd).toHaveBeenCalledTimes(1);
  const [stream, , fields] = redis.xAdd.mock.calls[0] as unknown as [string, string, any];
  expect(stream).not.toBe('workflow:events:global');
  expect(fields).toMatchObject({ targetSubscriber: 'search-index', force: '1', channel: 'global' });
  expect(JSON.parse(fields.event).id).toBe(input.id);
});
it('replays only the selected subscriber despite processed Redis markers and leaves unrelated consumers untouched', async () => {
  const bus = EventBus.getInstance() as any, input = event(), search = vi.fn(), email = vi.fn();
  bus.handlerIds.set(search, 'search-index'); bus.handlerIds.set(email, 'email');
  await bus.processStreamMessage(redis, getRedisConfig(), 'stream', { channel: 'global', handlers: new Set([email, search]) },
    { id: '1-0', message: { event: JSON.stringify(input), force: '1', targetSubscriber: 'search-index' } });
  expect(search).toHaveBeenCalledExactlyOnceWith(input); expect(email).not.toHaveBeenCalled();
  expect(redis.sIsMember).not.toHaveBeenCalled(); expect(redis.xAck).toHaveBeenCalledTimes(1);
  expect(redis.sAdd).toHaveBeenCalledExactlyOnceWith(`processed_event_handlers:${input.payload.tenantId}`, JSON.stringify([input.id, 'global', 'search-index']));
});
it('does not acknowledge targeted work when its subscriber is missing or fails', async () => {
  const bus = EventBus.getInstance() as any, input = event(), sibling = vi.fn(), target = vi.fn().mockRejectedValue(new Error('retry'));
  bus.handlerIds.set(target, 'search-index');
  const message = { id: '1-0', message: { event: JSON.stringify(input), force: '1', targetSubscriber: 'search-index' } };
  await bus.processStreamMessage(redis, getRedisConfig(), 'stream', { channel: 'global', handlers: new Set([sibling]) }, message);
  await bus.processStreamMessage(redis, getRedisConfig(), 'stream', { channel: 'global', handlers: new Set([sibling, target]) }, message);
  expect(sibling).not.toHaveBeenCalled(); expect(target).toHaveBeenCalledTimes(1); expect(redis.xAck).not.toHaveBeenCalled();
});
it.each([{ force: false, eventId: randomUUID(), targetSubscriber: 'search-index' }, { force: true, targetSubscriber: 'search-index' },
  { force: true, eventId: randomUUID(), targetSubscriber: 'invalid subscriber' }])('rejects incomplete targeted recovery before transport', async options => {
  const input = event();
  await expect(EventBus.getInstance().publish({ eventType: input.eventType, payload: input.payload } as any, options)).rejects.toThrow('Targeted event recovery requires');
  expect(redis.xAdd).not.toHaveBeenCalled();
});

it('processes the same stable event independently on each channel and deduplicates repeats within that channel', async () => {
  const bus = EventBus.getInstance() as any, input = event(), handler = vi.fn(), processed = new Set<string>();
  redis.sIsMember.mockImplementation(async (_key: string, member: string) => processed.has(member));
  redis.sAdd.mockImplementation(async (_key: string, member: string) => { processed.add(member); return 1; });
  bus.handlerIds.set(handler, 'same-subscriber');
  for (const channel of ['global', 'internal-notifications', 'global', 'internal-notifications']) {
    await bus.processStreamMessage(redis, getRedisConfig(), channel, { channel, handlers: new Set([handler]) },
      { id: '1-0', message: { event: JSON.stringify(input), channel } });
  }
  expect(handler).toHaveBeenCalledTimes(2); expect(redis.xAck).toHaveBeenCalledTimes(4);
  expect(processed.size).toBe(4);
});
