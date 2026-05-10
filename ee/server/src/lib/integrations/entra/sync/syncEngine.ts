import type { EntraSyncUser } from './types';
import { EntraSyncResultAggregator } from './syncResultAggregator';
import { findContactMatchesByEmail } from './contactMatcher';
import {
  createContactForEntraUser,
  linkExistingMatchedContact,
  queueAmbiguousContactMatch,
} from './contactReconciler';

export interface ExecuteEntraSyncInput {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
  users: EntraSyncUser[];
  portalEntitlement?: {
    provisioningMode: 'disabled' | 'built_in' | 'workflow_managed';
    groupId: string | null;
    membershipMode: 'transitive' | 'direct';
  };
  fieldSyncConfig?: Record<string, unknown>;
  dryRun?: boolean;
}

export interface ExecuteEntraSyncResult {
  dryRun: boolean;
  counters: {
    created: number;
    linked: number;
    updated: number;
    ambiguous: number;
    inactivated: number;
  };
}

export async function executeEntraSync(
  input: ExecuteEntraSyncInput
): Promise<ExecuteEntraSyncResult> {
  const dryRun = Boolean(input.dryRun);
  const counters = new EntraSyncResultAggregator();

  for (const user of input.users) {
    const userWithEntitlement: EntraSyncUser = input.portalEntitlement
      ? {
          ...user,
          clientPortalEntitlement: {
            groupId: input.portalEntitlement.groupId,
            membershipMode: input.portalEntitlement.membershipMode,
            isMember: null,
          },
        }
      : user;
    const candidates = await findContactMatchesByEmail(input.tenantId, input.clientId, userWithEntitlement);

    if (candidates.length > 1) {
      counters.increment('ambiguous');
      if (!dryRun) {
        await queueAmbiguousContactMatch(
          input.tenantId,
          input.clientId,
          input.managedTenantId,
          userWithEntitlement,
          candidates
        );
      }
      continue;
    }

    if (candidates.length === 1) {
      counters.increment('linked');
      if (!dryRun) {
        await linkExistingMatchedContact(
          input.tenantId,
          input.clientId,
          candidates[0],
          userWithEntitlement,
          input.fieldSyncConfig
        );
      }
      continue;
    }

    counters.increment('created');
    if (!dryRun) {
      await createContactForEntraUser(input.tenantId, input.clientId, userWithEntitlement);
    }
  }

  return {
    dryRun,
    counters: counters.toJSON(),
  };
}
