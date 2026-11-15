import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface CoManagedAcceptanceScope {
  sponsorTenant: string;
  sponsorName: string;
  visibilityMode: 'board_scope' | 'escalation_only';
  escalationBoard: { id: string; name: string };
  boards: Array<{ id: string; name: string; canCollaborate: boolean }>;
  projects: string[];
  delegatedAdministration: string[];
}
export class CoManagedAcceptanceError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_PENDING' | 'SCOPE_CHANGED' | 'CAPACITY_UNAVAILABLE' | 'DESTINATION_UNAVAILABLE') {
    super({ FORBIDDEN: 'A customer administrator in this workspace must accept the relationship.',
      NOT_PENDING: 'This relationship is not awaiting acceptance.',
      SCOPE_CHANGED: 'The proposed scope changed. Review it again before accepting.',
      CAPACITY_UNAVAILABLE: 'The sponsoring MSP must restore its Pro license and allocated co-managed seats before activation.',
      DESTINATION_UNAVAILABLE: 'The MSP escalation queue for this relationship is no longer available.',
    }[code]);
    this.name = 'CoManagedAcceptanceError';
  }
}

export async function readCoManagedAcceptanceScope(db: Knex, relationship: any, lock = false): Promise<CoManagedAcceptanceScope> {
  const sponsor = tenantDb(db, relationship.sponsor_tenant);
  const owner = await sponsor.table('tenants').first('client_name');
  const destinations = sponsor.table('boards').where({ board_id: relationship.escalation_board_id, is_inactive: false });
  if (lock) destinations.forShare();
  const destination = await destinations.first('board_id', 'board_name');
  if (!owner) throw new CoManagedAcceptanceError('NOT_PENDING');
  if (!destination) throw new CoManagedAcceptanceError('DESTINATION_UNAVAILABLE');
  const customer = tenantDb(db, relationship.tenant);
  const scopeQuery = customer.table('co_management_board_scopes').where('relationship_id', relationship.relationship_id).orderBy('board_id');
  if (lock) scopeQuery.forShare();
  const scopes = await scopeQuery;
  const boards: CoManagedAcceptanceScope['boards'] = [];
  for (const scope of scopes) {
    const boardQuery = customer.table('boards').where({ board_id: scope.board_id, is_inactive: false });
    if (lock) boardQuery.forShare();
    const board = await boardQuery.first('board_name');
    if (!board) throw new CoManagedAcceptanceError('SCOPE_CHANGED');
    boards.push({ id: scope.board_id, name: board.board_name, canCollaborate: scope.can_collaborate });
  }
  if (relationship.visibility_mode === 'escalation_only' && boards.length) throw new CoManagedAcceptanceError('SCOPE_CHANGED');
  return { sponsorTenant: relationship.sponsor_tenant, sponsorName: owner.client_name,
    visibilityMode: relationship.visibility_mode, escalationBoard: { id: destination.board_id, name: destination.board_name },
    boards, projects: [], delegatedAdministration: [] };
}
export function coManagedScopeFingerprint(scope: CoManagedAcceptanceScope): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

