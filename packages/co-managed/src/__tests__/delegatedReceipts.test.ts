import { describe, expect, it } from 'vitest';
import { coManagedDelegatedReceipts } from '../delegatedAdministration';
import { coManagedDisplayName } from '../actorReferences';
import { CoManagedSharedWorkError } from '../sharedWorkIdentity';
import { registerCoManagedAccessReductionRetainer, retainCoManagedBeforeAccessReduction } from '../participationEvidence';

describe('delegated receipts are immutable in app code', () => {
  it('the writer refuses update and delete', async () => {
    await expect(coManagedDelegatedReceipts.update()).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    await expect(coManagedDelegatedReceipts.delete()).rejects.toBeInstanceOf(CoManagedSharedWorkError);
  });
  it('append refuses to run outside a transaction', async () => {
    await expect(coManagedDelegatedReceipts.append({ isTransaction: false } as any, {} as any)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
  });
});

describe('attribution names', () => {
  it('never renders "null null"', () => {
    expect(coManagedDisplayName({ first_name: null, last_name: null }, 'a@b.c')).toBe('a@b.c');
    expect(coManagedDisplayName({ first_name: 'Ada', last_name: null }, 'x')).toBe('Ada');
    expect(coManagedDisplayName(undefined, 'Unknown')).toBe('Unknown');
  });
});

describe('access-reduction retainer registry', () => {
  const trx: any = { isTransaction: true };
  const ctx = { trx, customerTenant: 't', relationshipId: 'r', operationId: 'o', resources: [{ kind: 'ticket' as const, id: 'x' }] };
  it('runs registered retainers in name order, and is a no-op with none', async () => {
    await retainCoManagedBeforeAccessReduction(ctx);
    const calls: string[] = [];
    const offB = registerCoManagedAccessReductionRetainer('b', async () => { calls.push('b'); });
    const offA = registerCoManagedAccessReductionRetainer('a', async () => { calls.push('a'); });
    await retainCoManagedBeforeAccessReduction(ctx);
    expect(calls).toEqual(['a', 'b']);
    offA(); offB();
    await retainCoManagedBeforeAccessReduction(ctx);
    expect(calls).toHaveLength(2);
  });
});
