import type { CoManagedUpgradeClosure } from './upgradeClosure';
import { verifyCoManagedDepartedClosure } from './departedClosureVerification';
import { closeCoManagedRelationship } from './relationshipClosure';
import { finalizeCoManagedArchive } from './archiveFinalization';

/**
 * L7a owns closure, evidence retention, archive sealing, relationship termination and the one-time
 * allocation release. The closure primitive calls withTransaction; when passed the upgrade
 * transaction, that helper reuses it directly. Any later upgrade failure therefore rolls back the
 * closure writes and the enclosing upgrade writes together, without opening a nested savepoint.
 */
export const coManagedUpgradeClosure: CoManagedUpgradeClosure = {
  get available() { return true; },
  async closeAndArchive(trx, actor, target, request) {
    return closeCoManagedRelationship(trx, actor, target, request, finalizeCoManagedArchive);
  },
  verifyDepartedClosure: verifyCoManagedDepartedClosure,
};
