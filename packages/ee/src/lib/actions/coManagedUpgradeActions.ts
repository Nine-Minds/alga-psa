'use server';
import type { CoManagedIndependentUpgradeRequest } from '@alga-psa/co-managed';

export async function getCoManagedUpgradeScreenAction(): Promise<
  { state: 'completed'; operationId: string; progress: 'completed' } |
  { state: 'eligible'; relationshipId: string; revision: number; departed: boolean; selfHosted: boolean;
    seatsRequired: number; entitlementReady: boolean; progress: 'idle' | 'running' | 'completed' | 'failed' | 'unavailable' }
> { throw new Error('Independent upgrades require the licensed tenant workflow worker.'); }

export async function startCoManagedUpgradeAction(_input: CoManagedIndependentUpgradeRequest & { relationshipId: string }): Promise<
  { completed: boolean; enqueued: boolean }
> { throw new Error('Independent upgrades require the licensed tenant workflow worker.'); }
