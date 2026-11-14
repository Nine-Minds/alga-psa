import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  definitions: [] as Array<{ tag_id: string; tag_text: string; created_at: string }>,
  mappings: [] as Array<{ tag_id: string; tagged_id: string; tenant: string; tagged_type: string }>,
  events: [] as string[],
  hooks: new Map<object, Array<() => unknown | Promise<unknown>>>(),
  nextTransactionId: 0,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: any) => fn,
}));

vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: vi.fn(async () => true),
  throwPermissionErrorAsync: vi.fn(),
}));

vi.mock('../lib/uiHelpers', () => ({
  generateEntityColorAsync: vi.fn(async () => ({ backgroundColor: '#fff', textColor: '#000' })),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  registerAfterCommit: (trx: object, hook: () => unknown | Promise<unknown>) => {
    const hooks = state.hooks.get(trx) ?? [];
    hooks.push(hook);
    state.hooks.set(trx, hooks);
  },
  tenantDb: (_trx: object, _tenant: string) => ({
    table: (table: string) => {
      if (table !== 'tag_mappings') throw new Error(`Unexpected table: ${table}`);
      return {
        insert: (rows: typeof state.mappings) => {
          state.mappings.push(...rows);
          const query: any = {
            onConflict: () => query,
            ignore: () => query,
            returning: async () => rows.map(({ tag_id, tagged_id }) => ({ tag_id, tagged_id })),
          };
          return query;
        },
      };
    },
  }),
  withTransaction: async (_db: unknown, callback: (trx: object) => Promise<unknown>) => {
    const trx = { id: ++state.nextTransactionId };
    state.hooks.set(trx, []);
    try {
      const result = await callback(trx);
      for (const hook of state.hooks.get(trx) ?? []) await hook();
      state.hooks.delete(trx);
      return result;
    } catch (error) {
      state.hooks.delete(trx);
      throw error;
    }
  },
}));

vi.mock('../models/tagDefinition', () => ({
  default: {
    getOrCreateWithStatus: async (_trx: object, _tenant: string, tagText: string) => {
      const existing = state.definitions.find((definition) => definition.tag_text === tagText);
      if (existing) return { definition: existing, created: false };
      const definition = {
        tag_id: `tag-${state.definitions.length + 1}`,
        tag_text: tagText,
        created_at: '2026-11-01T00:00:00.000Z',
      };
      state.definitions.push(definition);
      return { definition, created: true };
    },
    findByTextAndType: vi.fn(),
  },
}));

vi.mock('../models/tagMapping', () => ({
  default: {
    getByEntities: async (_trx: object, tenant: string, entityIds: string[], taggedType: string) =>
      state.mappings
        .filter((mapping) => mapping.tenant === tenant && mapping.tagged_type === taggedType && entityIds.includes(mapping.tagged_id))
        .map((mapping) => ({ ...mapping, tag_text: state.definitions.find((definition) => definition.tag_id === mapping.tag_id)?.tag_text ?? '' })),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: async (event: { eventType: string }) => {
    state.events.push(event.eventType);
  },
}));

vi.mock('@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads', () => ({
  buildTicketUpdatedPayload: (payload: unknown) => payload,
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildTagAppliedPayload: (payload: unknown) => payload,
  buildTagDefinitionCreatedPayload: (payload: unknown) => payload,
  buildTagDefinitionUpdatedPayload: (payload: unknown) => payload,
  buildTagRemovedPayload: (payload: unknown) => payload,
  buildProjectTaskUpdatedPayload: (payload: unknown) => payload,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: vi.fn(),
  isAuthorizationThrow: () => false,
  permissionError: vi.fn(),
}));

import { withTransaction } from '@alga-psa/db';
import { bulkApplyTagsToEntities } from './tagActions';

describe('bulkApplyTagsToEntities transaction behavior', () => {
  beforeEach(() => {
    state.definitions = [];
    state.mappings = [];
    state.events = [];
    state.hooks.clear();
    state.nextTransactionId = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('rejects invalid tag text without creating definitions or mappings', async () => {
    await (withTransaction as any)({}, (trx: object) =>
      (bulkApplyTagsToEntities as any)(trx, 'tenant-1', 'ticket', [
        { entityId: 'ticket-1', newTexts: ['not|allowed'], existingTexts: [] },
      ]),
    );

    expect(state.definitions).toEqual([]);
    expect(state.mappings).toEqual([]);
    expect(state.events).toEqual([]);
  });

  it('drops queued publications when a later operation rolls back the transaction', async () => {
    await expect((withTransaction as any)({}, async (trx: object) => {
      await (bulkApplyTagsToEntities as any)(trx, 'tenant-1', 'ticket', [
        { entityId: 'ticket-1', newTexts: ['urgent'], existingTexts: [] },
      ]);
      expect(state.events).toEqual([]);
      throw new Error('later transaction work failed');
    })).rejects.toThrow('later transaction work failed');

    expect(state.events).toEqual([]);
  });

  it('publishes definition, application, and ticket update events after commit', async () => {
    await (withTransaction as any)({}, async (trx: object) => {
      await (bulkApplyTagsToEntities as any)(trx, 'tenant-1', 'ticket', [
        { entityId: 'ticket-1', newTexts: ['urgent'], existingTexts: [] },
      ]);
      expect(state.events).toEqual([]);
    });

    expect(state.events).toEqual(['TAG_DEFINITION_CREATED', 'TAG_APPLIED', 'TICKET_UPDATED']);
    expect(state.definitions).toHaveLength(1);
    expect(state.mappings).toHaveLength(1);
  });
});
