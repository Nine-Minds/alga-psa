import { beforeEach, describe, expect, it, vi } from 'vitest';

const published: any[] = [];
const hooks: Array<() => unknown> = [];

vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: (_trx: unknown, hook: () => unknown) => {
    hooks.push(hook);
  },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async (event: any) => {
    published.push(event);
  }),
}));
vi.mock('@alga-psa/shared/models/contactModel', () => ({ ContactModel: {} }));

const flush = async () => {
  for (const hook of hooks.splice(0)) await hook();
};

const base = { contact_name_id: 'c1', client_id: 'k1', full_name: 'Ada', email: 'ada@example.com', is_inactive: false };

describe('contactEvents', () => {
  beforeEach(() => {
    published.length = 0;
    hooks.length = 0;
  });

  it('queues nothing until the transaction commits, then publishes CONTACT_CREATED once', async () => {
    const { queueContactCreated } = await import('./contactEvents');
    queueContactCreated({} as any, 't1', { ...base, created_at: '2026-01-01T00:00:00.000Z' }, { actorUserId: 'u1' });
    expect(published).toHaveLength(0);
    await flush();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      eventType: 'CONTACT_CREATED',
      idempotencyKey: 'contact_created:c1',
      ctx: { tenantId: 't1', actor: { actorUserId: 'u1' } },
    });
  });

  it('publishes CONTACT_UPDATED with the changed fields only (client move)', async () => {
    const { queueContactUpdated } = await import('./contactEvents');
    queueContactUpdated({} as any, 't1', base, { ...base, client_id: 'k2' }, ['client_id', 'full_name']);
    await flush();
    expect(published).toHaveLength(1);
    expect(published[0].eventType).toBe('CONTACT_UPDATED');
    expect(published[0].payload.updatedFields).toEqual(['clientId']);
  });

  it('publishes nothing when no listed field actually changed', async () => {
    const { queueContactUpdated } = await import('./contactEvents');
    queueContactUpdated({} as any, 't1', base, { ...base }, ['full_name', 'email']);
    await flush();
    expect(published).toHaveLength(0);
  });

  it('adds CONTACT_ARCHIVED on the false -> true is_inactive flip only', async () => {
    const { queueContactUpdated } = await import('./contactEvents');
    queueContactUpdated({} as any, 't1', base, { ...base, is_inactive: true }, ['is_inactive']);
    await flush();
    expect(published.map((e) => e.eventType).sort()).toEqual(['CONTACT_ARCHIVED', 'CONTACT_UPDATED']);

    published.length = 0;
    queueContactUpdated({} as any, 't1', { ...base, is_inactive: true }, base, ['is_inactive']);
    await flush();
    expect(published.map((e) => e.eventType)).toEqual(['CONTACT_UPDATED']);
  });
});
