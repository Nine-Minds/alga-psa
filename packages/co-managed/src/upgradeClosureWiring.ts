import type { CoManagedUpgradeClosure } from './upgradeClosure';
import { verifyCoManagedDepartedClosure } from './departedClosureVerification';

/**
 * THE wiring point for CM L7a. Until L7a lands on main there is no closure to call, so this fails
 * closed: `available` is false (the upgrade gate is closed and no purchase is prepared) and
 * `closeAndArchive` throws, so an independent upgrade of a live relationship cannot run and nothing
 * is half-closed.
 *
 * The departed-customer check is already L8b's own read of L7a's closure, manifest and allocation
 * tables (`departedClosureVerification.ts`); it is unreachable while `available` is false.
 *
 * When L7a merges (`closeCoManagedRelationship` in packages/co-managed/src/relationshipClosure.ts,
 * `finalizeCoManagedArchive` in archiveFinalization.ts), replace the first two members with
 *   available: true
 *   closeAndArchive: (trx, actor, target, request) => closeCoManagedRelationship(trx, actor, target, request, finalizeCoManagedArchive)
 * and add L7a's `coManagedArchiveManifestHash` recomputation to the departed check. Nothing else changes.
 */
export const coManagedUpgradeClosure: CoManagedUpgradeClosure = {
  get available() { return false; },
  async closeAndArchive() { throw new Error('CM L7a relationship closure is not available in this build'); },
  verifyDepartedClosure: verifyCoManagedDepartedClosure,
};
