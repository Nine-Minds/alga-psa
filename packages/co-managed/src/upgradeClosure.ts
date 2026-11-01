import type { Knex } from 'knex';
import type { CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedPolicyTarget } from './policy';

/**
 * Contract seam to CM L7a (relationship closure, archive finalisation, allocation release).
 *
 * L8b CALLS these; it never reimplements them, and "the allocation is released once" is proved by
 * L7a's own closure receipt, not by a counter here. Signatures follow the reference branch
 * (`closeCoManagedRelationship(trx, actor, target, { operationId, expectedRevision, reason }, finalizeCoManagedArchive)`).
 *
 * Injected so unit tests use fakes and so wiring L7a is a one-line change in `upgradeClosureWiring.ts`.
 */
export interface CoManagedUpgradeClosure {
  /**
   * False until L7a is wired. While false, nothing that leads to an upgrade may start: the upgrade
   * gate is closed (no page, no screen, no mutation) and no purchase is prepared, so a customer can
   * never be charged for an independence that the closure step would then refuse.
   */
  readonly available: boolean;
  /**
   * Close an ACTIVE relationship with reason `independent_upgrade`, finalise its archive (with
   * manifest hash) and release the MSP's allocation, all inside `trx`. Idempotent per `operationId`.
   */
  closeAndArchive(trx: Knex.Transaction, actor: CoManagedSessionActor, target: CoManagedPolicyTarget,
    request: { operationId: string; expectedRevision: number; reason: 'independent_upgrade' }): Promise<{ operationId: string }>;
  /**
   * The customer already departed (relationship `terminated`): verify, never redo, that the earlier
   * closure is sealed (archive manifest hash intact, cutoff equal, allocation released) and return
   * its operation id. Throws if any of that does not hold.
   */
  verifyDepartedClosure(trx: Knex.Transaction, target: CoManagedPolicyTarget,
    relationship: { revision: number; ended_at: Date | string | null; sponsor_tenant: string }): Promise<{ operationId: string }>;
}
