import type { CoManagedClientManagementView, CoManagedClientRelationshipView } from '@alga-psa/co-managed';

export function relationship(overrides: Partial<CoManagedClientRelationshipView> = {}): CoManagedClientRelationshipView {
  return {
    relationshipId: 'rel-1', operationId: 'op-1', state: 'active', ended: false, workspaceName: 'Acme Workspace',
    endedAt: null, retained: false, seats: 5, usedSeats: 2, administratorEmail: 'admin@example.com',
    canManage: true, canChangeSeats: false, canRetry: false, canCancel: false,
    invitationSent: true, invitationExpired: false, deliveryFailed: false, cleanupFailed: false,
    ...overrides,
  };
}

export function view(overrides: Partial<CoManagedClientManagementView> = {}): CoManagedClientManagementView {
  return {
    clientId: 'client-1', clientName: 'Acme', selectionRequired: false, inconsistent: false,
    selectedRelationshipId: null, canManage: true, canSetUp: true, relationships: [], ...overrides,
  };
}

/** The six header cases the acceptance criteria name, as views. */
export const HEADER_CASES = {
  noRelationshipAuthorized: view({ canSetUp: true }),
  noRelationshipUnauthorized: view({ canSetUp: false, canManage: false }),
  active: view({ selectedRelationshipId: 'rel-1', relationships: [relationship()] }),
  ended: view({
    selectedRelationshipId: 'rel-1', canSetUp: false,
    relationships: [relationship({ state: 'terminated', ended: true, retained: true, endedAt: '2026-10-01T00:00:00.000Z', usedSeats: null })],
  }),
  oneLiveOneEnded: view({
    selectedRelationshipId: 'rel-1',
    relationships: [relationship(), relationship({ relationshipId: 'rel-0', state: 'terminated', ended: true, retained: true, endedAt: '2026-01-01T00:00:00.000Z' })],
  }),
  severalLive: view({
    selectionRequired: true, canSetUp: false,
    relationships: [relationship(), relationship({ relationshipId: 'rel-2', workspaceName: 'Second' })],
  }),
  cancelledOnly: view({
    canSetUp: true,
    relationships: [relationship({ state: 'cancelled', ended: true, retained: false, endedAt: '2026-10-02T00:00:00.000Z', usedSeats: null })],
  }),
};
