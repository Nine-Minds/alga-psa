/**
 * Classification of the user row (if any) that already owns a contact's email
 * address inside one tenant.
 *
 * Deleting a contact through a path that skips dependency validation leaves its
 * portal user behind with a dangling or nulled `contact_id`: the person can no
 * longer be invited (the email is taken) and cannot sign in (their contact is
 * gone). Those rows are `orphaned` and are safe to relink to the contact being
 * invited; every other owner is a genuine conflict.
 */
export type PortalEmailOwnerStatus =
  | 'linked_this_contact'
  | 'linked_other_contact'
  | 'orphaned'
  | 'internal';

export interface PortalEmailOwnerRow {
  user_id: string;
  user_type: string | null;
  contact_id: string | null;
  username?: string | null;
  /** `contacts.contact_name_id` from the left join; null when the contact is gone. */
  linked_contact_id: string | null;
}

export function classifyPortalEmailOwner(
  owner: PortalEmailOwnerRow,
  contactId: string
): PortalEmailOwnerStatus {
  if (owner.user_type !== 'client') {
    return 'internal';
  }
  if (!owner.contact_id || !owner.linked_contact_id) {
    return 'orphaned';
  }
  return owner.contact_id === contactId ? 'linked_this_contact' : 'linked_other_contact';
}

export function portalEmailOwnerConflictMessage(status: PortalEmailOwnerStatus): string {
  return status === 'internal'
    ? 'This email address belongs to an internal user in this organization.'
    : 'This email address is already linked to another contact in this organization.';
}
