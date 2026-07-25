import type { EntraSyncUser } from './types';
import { EntraSyncResultAggregator } from './syncResultAggregator';
import { findContactMatchesByEmail } from './contactMatcher';
import {
  createContactForEntraUser,
  linkExistingMatchedContact,
  previewLinkedContactChange,
  queueAmbiguousContactMatch,
} from './contactReconciler';
import {
  countEntraIdentityLinkedContacts,
  markDisabledEntraUsersInactive,
  type EntraIdentityRef,
} from './disableHandler';

/** What the sync would do to one identity, in the operator's terms. */
export type EntraSyncPreviewBucket =
  | 'create'
  | 'link'
  | 'needs_decision'
  | 'no_change'
  | 'mark_inactive';

export interface EntraSyncPreviewIdentity {
  bucket: EntraSyncPreviewBucket;
  entraObjectId: string;
  displayName: string | null;
  email: string | null;
  userPrincipalName: string | null;
}

export interface EntraDisabledIdentityInput extends EntraIdentityRef {
  displayName?: string | null;
  email?: string | null;
  userPrincipalName?: string | null;
}

export interface ExecuteEntraSyncInput {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
  users: EntraSyncUser[];
  fieldSyncConfig?: Record<string, unknown>;
  dryRun?: boolean;
  /**
   * Identities the provider reported as disabled upstream. Handled here rather
   * than by the caller so the dry-run guard is total: F8 was a real preview
   * that deactivated real contacts because inactivation ran outside this
   * function and outside the flag.
   */
  disabledIdentities?: EntraDisabledIdentityInput[];
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
  /** Per-identity classification. Only collected on a dry run. */
  preview?: EntraSyncPreviewIdentity[];
}

function describeUser(
  user: EntraSyncUser,
  bucket: EntraSyncPreviewBucket
): EntraSyncPreviewIdentity {
  return {
    bucket,
    entraObjectId: user.entraObjectId,
    displayName: user.displayName,
    email: user.email,
    userPrincipalName: user.userPrincipalName,
  };
}

export async function executeEntraSync(
  input: ExecuteEntraSyncInput
): Promise<ExecuteEntraSyncResult> {
  const dryRun = Boolean(input.dryRun);
  const counters = new EntraSyncResultAggregator();
  const preview: EntraSyncPreviewIdentity[] | undefined = dryRun ? [] : undefined;

  for (const user of input.users) {
    const candidates = await findContactMatchesByEmail(input.tenantId, input.clientId, user);

    if (candidates.length > 1) {
      counters.increment('ambiguous');
      if (dryRun) {
        preview?.push(describeUser(user, 'needs_decision'));
      } else {
        await queueAmbiguousContactMatch(
          input.tenantId,
          input.clientId,
          input.managedTenantId,
          user,
          candidates
        );
      }
      continue;
    }

    if (candidates.length === 1) {
      counters.increment('linked');
      if (dryRun) {
        // The preview answers "would this change anything?" with the same rule
        // the real run applies, so the counts match on unchanged data.
        const outcome = await previewLinkedContactChange(
          input.tenantId,
          candidates[0],
          user,
          input.fieldSyncConfig
        );
        if (outcome.fieldsWouldChange) {
          counters.increment('updated');
        }
        preview?.push(
          describeUser(
            user,
            outcome.alreadyLinked && !outcome.fieldsWouldChange ? 'no_change' : 'link'
          )
        );
      } else {
        // `updated` counts contacts whose values the field-sync rules actually
        // changed. A link that overwrote nothing is a link and nothing more.
        const linked = await linkExistingMatchedContact(
          input.tenantId,
          input.clientId,
          candidates[0],
          user,
          input.fieldSyncConfig
        );
        if (linked.fieldsUpdated) {
          counters.increment('updated');
        }
      }
      continue;
    }

    counters.increment('created');
    if (dryRun) {
      preview?.push(describeUser(user, 'create'));
    } else {
      await createContactForEntraUser(input.tenantId, input.clientId, user);
    }
  }

  const disabledIdentities = input.disabledIdentities || [];
  if (disabledIdentities.length > 0) {
    if (dryRun) {
      const wouldInactivate = await countEntraIdentityLinkedContacts(
        input.tenantId,
        disabledIdentities
      );
      for (let index = 0; index < wouldInactivate; index += 1) {
        counters.increment('inactivated');
      }
      for (const identity of disabledIdentities) {
        preview?.push({
          bucket: 'mark_inactive',
          entraObjectId: identity.entraObjectId,
          displayName: identity.displayName ?? null,
          email: identity.email ?? null,
          userPrincipalName: identity.userPrincipalName ?? null,
        });
      }
    } else {
      const inactivated = await markDisabledEntraUsersInactive(
        input.tenantId,
        disabledIdentities.map((identity) => ({
          entraTenantId: identity.entraTenantId,
          entraObjectId: identity.entraObjectId,
        }))
      );
      for (let index = 0; index < inactivated; index += 1) {
        counters.increment('inactivated');
      }
    }
  }

  return {
    dryRun,
    counters: counters.toJSON(),
    ...(preview ? { preview } : {}),
  };
}
