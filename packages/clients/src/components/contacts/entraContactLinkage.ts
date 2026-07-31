/**
 * What a contact record already knows about its Entra link, read for the first
 * time.
 *
 * The sync has been writing entra_sync_source, entra_user_principal_name,
 * last_entra_sync_at, entra_account_enabled and entra_sync_status_reason onto
 * contacts since phase 1, and nothing displayed any of it. A technician looking
 * at a contact could not tell it was maintained by a directory, why it went
 * inactive, or which of its fields a rule was about to overwrite.
 *
 * Pure, and defensive about shape: it reads a contact record that carries an
 * index signature, so every field is `unknown` until proven otherwise.
 */

export interface EntraContactLinkage {
  isLinked: boolean;
  userPrincipalName: string | null;
  lastSyncedAt: string | null;
  accountEnabled: boolean | null;
  /** 'inactive' when the sync deactivated it; otherwise whatever the sync set. */
  syncStatus: string | null;
  syncStatusReason: string | null;
}

type ContactLike = Record<string, unknown> | null | undefined;

function readString(source: ContactLike, key: string): string | null {
  const value = source?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTimestamp(source: ContactLike, key: string): string | null {
  const value = source?.[key];
  if (value instanceof Date) return value.toISOString();
  return readString(source, key);
}

export function readEntraContactLinkage(contact: ContactLike): EntraContactLinkage {
  const source = readString(contact, 'entra_sync_source');
  const objectId = readString(contact, 'entra_object_id');
  const accountEnabledRaw = contact?.entra_account_enabled;

  return {
    // Either marker is enough: the source names how it got here, the object id
    // proves an identity is attached.
    isLinked: Boolean(source) || Boolean(objectId),
    userPrincipalName: readString(contact, 'entra_user_principal_name'),
    lastSyncedAt: readTimestamp(contact, 'last_entra_sync_at'),
    accountEnabled: typeof accountEnabledRaw === 'boolean' ? accountEnabledRaw : null,
    syncStatus: readString(contact, 'entra_sync_status'),
    syncStatusReason: readString(contact, 'entra_sync_status_reason'),
  };
}

export type EntraInactiveReason = 'disabled_upstream' | 'deleted_upstream' | null;

/**
 * Why a contact is inactive, when Entra is the reason. "Inactive" alone sends a
 * technician looking for a person who changed it; naming the cause ends the
 * search.
 */
export function readEntraInactiveReason(contact: ContactLike): EntraInactiveReason {
  const linkage = readEntraContactLinkage(contact);
  const isInactive = contact?.is_inactive === true;

  if (!linkage.isLinked || !isInactive) {
    return null;
  }

  if (linkage.syncStatusReason === 'deleted_upstream') return 'deleted_upstream';
  if (linkage.syncStatusReason === 'disabled_upstream') return 'disabled_upstream';

  // Older rows recorded only the account state.
  return linkage.accountEnabled === false ? 'disabled_upstream' : null;
}

/** Contact fields a field-sync rule can overwrite, keyed by rule. */
export const ENTRA_SYNCED_CONTACT_FIELDS: Record<string, string[]> = {
  displayName: ['full_name'],
  email: ['email'],
  phone: ['phone_numbers'],
  role: ['role'],
  upn: ['entra_user_principal_name'],
};

/**
 * Whether an enabled rule will overwrite the field being edited on the next
 * sync — the difference between an edit that sticks and one that silently
 * reverts tomorrow morning.
 */
export function findOverwritingEntraRule(params: {
  contact: ContactLike;
  field: string;
  fieldSyncConfig: Record<string, unknown> | null | undefined;
}): string | null {
  if (!readEntraContactLinkage(params.contact).isLinked || !params.fieldSyncConfig) {
    return null;
  }

  for (const [rule, fields] of Object.entries(ENTRA_SYNCED_CONTACT_FIELDS)) {
    if (!fields.includes(params.field)) continue;
    const enabled = params.fieldSyncConfig[rule];
    if (enabled === true || enabled === 'true' || enabled === 1 || enabled === '1') {
      return rule;
    }
  }

  return null;
}
