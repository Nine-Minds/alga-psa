import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  TICKET_ACTIVITY_ACTOR: {}, TICKET_ACTIVITY_ENTITY: {}, TICKET_ACTIVITY_EVENT: {}, TICKET_ACTIVITY_SOURCE: {}, writeTicketActivity: vi.fn(),
}));
vi.mock('server/src/lib/auth/rbac', () => ({ hasPermission: vi.fn() }));
vi.mock('server/src/lib/api/middleware/apiContextPermission', () => ({ hasApiContextPermission: vi.fn() }));
vi.mock('server/src/lib/api/controllers/authorizationKernel', () => ({ projectApiResourceRead: vi.fn() }));
vi.mock('server/src/lib/api/controllers/assetReadGuard', () => ({ assertAssetRecordAccess: vi.fn() }));
vi.mock('server/src/lib/api/services/AssetService', () => ({ AssetService: class {} }));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({ createClientScopeContext: vi.fn() }));
vi.mock('server/src/lib/api/services/serviceContextSubject', () => ({ subjectFromServiceContext: vi.fn() }));
vi.mock('@/lib/productAccess', () => ({ ProductAccessError: class extends Error {}, getTenantProduct: vi.fn() }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn() }));

import { ENTITY_ADAPTERS } from 'server/src/lib/api/services/documents/entityAdapters';

describe('entity adapters: client visibility', () => {
  it('marks only ticket, project_task and client as portal-visible', () => {
    const visible = Object.values(ENTITY_ADAPTERS).filter((a) => a.portalVisible).map((a) => a.entityType).sort();
    expect(visible).toEqual(['client', 'project_task', 'ticket']);
  });

  it.each(['ticket', 'project_task', 'client'] as const)('%s: internal by default, visible on request', (type) => {
    const overrides = ENTITY_ADAPTERS[type].documentOverrides!;
    expect(overrides({})).toEqual({});
    expect(overrides({ isClientVisible: false })).toEqual({});
    expect(overrides({ isClientVisible: true })).toEqual({ is_client_visible: true });
  });

  it('a draft always wins; an explicit false does not undo it', () => {
    const overrides = ENTITY_ADAPTERS.ticket.documentOverrides!;
    expect(overrides({ commentAttachmentDraft: true })).toEqual({ is_client_visible: true });
    expect(overrides({ commentAttachmentDraft: true, isClientVisible: false })).toEqual({ is_client_visible: true });
  });

  it.each(['contact', 'asset'] as const)('%s never sets visibility', (type) => {
    expect(ENTITY_ADAPTERS[type].documentOverrides).toBeUndefined();
  });
});
