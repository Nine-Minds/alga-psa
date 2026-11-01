import type { CoManagedUpgradeClosure } from './upgradeClosure';

/**
 * THE wiring point for CM L7a. Until L7a lands on main there is no closure to call, so this fails
 * closed: an independent upgrade of a live relationship cannot run, and nothing is half-closed.
 *
 * When L7a merges, replace the body with
 *   available: true
 *   closeAndArchive: async (trx, actor, target, request) => closeCoManagedRelationship(trx, actor, target, request, finalizeCoManagedArchive)
 *   verifyDepartedClosure: <L7a's sealed-closure verifier>
 * and nothing else in L8b changes.
 */
export const coManagedUpgradeClosure: CoManagedUpgradeClosure = {
  get available() { return false; },
  async closeAndArchive() { throw new Error('CM L7a relationship closure is not available in this build'); },
  async verifyDepartedClosure() { throw new Error('CM L7a relationship closure is not available in this build'); },
};
