import type { CoManagedUpgradeClosure } from './upgradeClosure';
import { verifyCoManagedDepartedClosure } from './departedClosureVerification';
import { closeCoManagedRelationship } from './relationshipClosure';
import { finalizeCoManagedArchive } from './archiveFinalization';

/**
 * L7a owns closure, evidence retention, archive sealing, relationship termination and the one-time
 * allocation release. Its closure primitive creates its own transaction, so calling it with the
 * upgrade transaction uses Knex's nested transaction/savepoint contract: any later upgrade failure
 * rolls the enclosing transaction (including the closure savepoint) back atomically.
 */
export const coManagedUpgradeClosure: CoManagedUpgradeClosure = {
  get available() { return true; },
  async closeAndArchive(trx, actor, target, request) {
    return closeCoManagedRelationship(trx, actor, target, request, finalizeCoManagedArchive);
  },
  verifyDepartedClosure: verifyCoManagedDepartedClosure,
};
