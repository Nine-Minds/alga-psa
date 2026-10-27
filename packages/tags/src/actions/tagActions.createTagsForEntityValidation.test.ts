/**
 * createTagsForEntityWithTransaction validates tag text with the same rules as
 * createTag (validateTagText): blank, over-long and invalid-character tags are
 * skipped, and valid ones are stored trimmed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getOrCreateWithStatus: vi.fn(),
  findByTextAndType: vi.fn(),
  insertMapping: vi.fn(),
  registerAfterCommit: vi.fn(),
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
  registerAfterCommit: h.registerAfterCommit,
  tenantDb: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('../models/tagDefinition', () => ({
  default: { getOrCreateWithStatus: h.getOrCreateWithStatus, findByTextAndType: h.findByTextAndType },
}));
vi.mock('../models/tagMapping', () => ({ default: { insert: h.insertMapping } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads', () => ({ buildTicketUpdatedPayload: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildTagAppliedPayload: vi.fn(),
  buildTagDefinitionCreatedPayload: vi.fn(),
  buildTagDefinitionUpdatedPayload: vi.fn(),
  buildTagRemovedPayload: vi.fn(),
  buildProjectTaskUpdatedPayload: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: vi.fn(),
  isAuthorizationThrow: () => false,
  permissionError: vi.fn(),
}));

import { createTagsForEntityWithTransaction } from './tagActions';

describe('createTagsForEntityWithTransaction — tag text validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getOrCreateWithStatus.mockImplementation(async (_trx, _tenant, tagText: string) => ({
      definition: { tag_id: `tag-${tagText}`, tag_text: tagText, background_color: '#fff', text_color: '#000' },
      created: false,
    }));
    h.insertMapping.mockImplementation(async () => ({ mapping_id: 'm', created_at: 'now' }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('skips tags validateTagText rejects and creates the rest, trimmed', async () => {
    const created = await (createTagsForEntityWithTransaction as any)(
      {} as any,
      'tenant-1',
      'contact-1',
      'contact',
      [
        { tag_text: '  VIP  ' },
        { tag_text: 'café' },
        { tag_text: 'pipe|' },
        { tag_text: 'x'.repeat(51) },
        { tag_text: '   ' },
        { tag_text: 'Key Account' },
      ],
    );

    expect(h.getOrCreateWithStatus.mock.calls.map((call) => call[2])).toEqual(['VIP', 'Key Account']);
    expect(created.map((tag: { tag_text: string }) => tag.tag_text)).toEqual(['VIP', 'Key Account']);
  });
});
