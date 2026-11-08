import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: 'u1', tenant: 't1', user_type: 'internal' }, { tenant: 't1' }, ...args),
}));
vi.mock('@alga-psa/auth/actions', () => ({ getUserRoles: async () => [{ role_name: 'Admin' }] }));
vi.mock('@/lib/webhooks/webhookModel', () => ({
  webhookModel: {
    getById: (...a: unknown[]) => state.getById(...a),
    update: (...a: unknown[]) => state.update(...a),
    insert: (...a: unknown[]) => state.insert(...a),
  },
}));
vi.mock('@/lib/db', () => ({ runWithTenant: async (_t: string, cb: () => Promise<unknown>) => cb() }));

import { upsertWebhook, listWebhookEvents } from '../webhookActions';

const WEBHOOK = '22222222-2222-4222-8222-222222222222';
const row = (eventTypes: string[]) => ({
  webhookId: WEBHOOK,
  tenant: 't1',
  name: 'Old',
  url: 'https://example.test/h',
  method: 'POST',
  eventTypes,
  isActive: true,
  verifySsl: true,
  customHeaders: null,
  eventFilter: null,
  payloadFields: null,
  retryConfig: null,
  rateLimitPerMin: null,
  totalDeliveries: 0,
  successfulDeliveries: 0,
  failedDeliveries: 0,
  consecutiveFailures: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const input = (eventTypes: string[], extra: Record<string, unknown> = {}) =>
  ({ name: 'Old', url: 'https://example.test/h', eventTypes, ...extra }) as any;

describe('admin upsertWebhook: legacy event types', () => {
  beforeEach(() => {
    state.getById.mockReset();
    state.update.mockReset();
    state.insert.mockReset();
    state.update.mockImplementation(async (_id: string, _t: string, patch: any) => row(patch.eventTypes ?? []));
    state.insert.mockImplementation(async (v: any) => row(v.eventTypes));
  });

  it('create rejects an unknown/legacy event type', async () => {
    const result: any = await (upsertWebhook as any)(input(['invoice.created']));
    expect(JSON.stringify(result)).toContain('unsupportedEventType');
    expect(state.insert).not.toHaveBeenCalled();
  });

  it('create accepts the new events', async () => {
    const result: any = await (upsertWebhook as any)(input(['client.created', 'contact.deactivated', 'client_location.deleted']));
    expect(JSON.stringify(result)).not.toContain('unsupportedEventType');
    expect(state.insert).toHaveBeenCalled();
  });

  it('update keeps a legacy name that is already stored', async () => {
    state.getById.mockResolvedValue(row(['invoice.created', 'ticket.updated']));
    const result: any = await (upsertWebhook as any)(
      input(['invoice.created', 'ticket.updated', 'client.created'], { webhookId: WEBHOOK }),
    );
    expect(JSON.stringify(result)).not.toContain('unsupportedEventType');
    expect(state.update).toHaveBeenCalledWith(
      WEBHOOK,
      't1',
      expect.objectContaining({ eventTypes: ['invoice.created', 'ticket.updated', 'client.created'] }),
    );
  });

  it('update can drop a legacy name', async () => {
    state.getById.mockResolvedValue(row(['invoice.created', 'ticket.updated']));
    await (upsertWebhook as any)(input(['ticket.updated'], { webhookId: WEBHOOK }));
    expect(state.update).toHaveBeenCalledWith(WEBHOOK, 't1', expect.objectContaining({ eventTypes: ['ticket.updated'] }));
  });

  it('update rejects a legacy name that was not already stored', async () => {
    state.getById.mockResolvedValue(row(['ticket.updated']));
    const result: any = await (upsertWebhook as any)(input(['ticket.updated', 'asset.created'], { webhookId: WEBHOOK }));
    expect(JSON.stringify(result)).toContain('unsupportedEventType');
    expect(state.update).not.toHaveBeenCalled();
  });

  it('listWebhookEvents does not advertise legacy names', async () => {
    const events: string[] = await (listWebhookEvents as any)();
    expect(events).toContain('client_location.deactivated');
    expect(events.filter((e) => /^(invoice|asset|system|workflow|time\.entry)\./.test(e) || e === 'custom.event')).toEqual([]);
  });
});
