import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * RMM signed-in user → client contact (FR-D1 / FR-D2).
 *
 * Every provider reports a last-signed-in user into
 * `workstation_assets.current_user` / `server_assets.current_user` in a
 * different shape: `CORP\jdoe`, `AzureAD\Jane Doe`, `.\Administrator`,
 * `jane.doe@acme.com`. These two functions turn that string into a normalized
 * key and then into a contact, or into nothing at all — an ambiguous name is
 * never guessed at.
 */

export interface NormalizedRmmUser {
  /** The lower-cased value with the domain prefix stripped; the mapping key. */
  key: string;
  /** Local part / account name, lower-cased. A display name keeps its space. */
  username: string;
  /** Lower-cased NetBIOS/AzureAD prefix, or null when there was none. */
  domain: string | null;
  /** Set only when the raw value is itself an email address. */
  email: string | null;
}

export type RmmContactMatchMethod = 'mapped' | 'email' | 'username' | 'name';

export interface RmmContactMatch {
  contactId: string;
  method: RmmContactMatchMethod;
}

/** Domain prefixes that carry no information about which directory a user is in. */
const LOCAL_DOMAIN_PREFIXES = new Set(['.', 'localhost', 'workgroup']);

/**
 * `CORP\jdoe` → `{ key: 'jdoe', username: 'jdoe', domain: 'corp', email: null }`.
 * Returns null for an empty or whitespace-only value.
 */
export function normalizeRmmUsername(raw: string | null | undefined): NormalizedRmmUser | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  // Both separators appear in the wild: Windows uses `\`, some agents report `/`.
  const separatorIndex = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  let domain: string | null = null;
  let account = trimmed;

  if (separatorIndex >= 0) {
    const prefix = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    account = trimmed.slice(separatorIndex + 1).trim();
    // `.\Administrator` is a local account: the prefix carries no directory.
    domain = prefix && !LOCAL_DOMAIN_PREFIXES.has(prefix) ? prefix : null;
  }

  if (!account) return null;

  const lowered = account.toLowerCase();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowered);

  return {
    key: lowered,
    // An email's local part is what the username rules match against; a
    // "First Last" display name keeps its space so the name rule can use it.
    username: isEmail ? lowered.slice(0, lowered.indexOf('@')) : lowered,
    domain,
    email: isEmail ? lowered : null,
  };
}

/** `rmm:<provider>` — the integration_type explicit user mappings are stored under. */
export function rmmUserMappingIntegrationType(provider: string): string {
  return `rmm:${provider}`;
}

function table(conn: Knex | Knex.Transaction, tenant: string, name: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(name) as Knex.QueryBuilder<any, any>;
}

/**
 * Resolves a normalized signed-in user to one of `clientId`'s contacts.
 *
 * Order, stopping at the first hit (FR-D2):
 *   1. an explicit mapping the MSP saved for this integration;
 *   2. a contact whose email equals the raw value when it is an email;
 *   3. exactly one contact whose email local part equals the username;
 *   4. exactly one contact whose full name equals the username.
 *
 * Ambiguity returns null — two people called Jane Doe means we do not know
 * which laptop is whose, and guessing would be worse than leaving it unassigned.
 */
export async function matchContactForRmmUser(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  integrationId: string,
  provider: string,
  normalized: NormalizedRmmUser
): Promise<RmmContactMatch | null> {
  const mapping = await table(conn, tenant, 'tenant_external_entity_mappings')
    .where({
      integration_type: rmmUserMappingIntegrationType(provider),
      alga_entity_type: 'contact',
      external_realm_id: integrationId,
      external_entity_id: normalized.key,
    })
    .first<{ alga_entity_id: string }>('alga_entity_id');

  if (mapping?.alga_entity_id) {
    // The mapping is tenant and integration scoped, but the contact must still
    // belong to this client — a re-pointed organization must not leak.
    const mapped = await table(conn, tenant, 'contacts')
      .where({ contact_name_id: mapping.alga_entity_id, client_id: clientId })
      .whereNot({ contact_kind: 'shared_mailbox' })
      .first<{ contact_name_id: string }>('contact_name_id');
    if (mapped) return { contactId: mapped.contact_name_id, method: 'mapped' };
  }

  /**
   * Only the contacts one of the three rules below could match. Loading every
   * contact of the client worked, but sync calls this once per device: a
   * 400-person client meant 400 rows read per machine, per run.
   *
   * The predicate is deliberately a superset of the rules — ambiguity has to
   * stay visible, so every row that could match comes back and the precedence
   * and "more than one" decisions are still made here.
   */
  const candidates = await table(conn, tenant, 'contacts')
    .where({ client_id: clientId })
    .whereNot({ contact_kind: 'shared_mailbox' })
    .where((builder: Knex.QueryBuilder) => {
      builder
        .whereRaw("split_part(lower(btrim(coalesce(email, ''))), '@', 1) = ?", [normalized.username])
        .orWhereRaw("lower(btrim(coalesce(full_name, ''))) = ?", [normalized.username]);
      if (normalized.email) {
        builder.orWhereRaw("lower(btrim(coalesce(email, ''))) = ?", [normalized.email]);
      }
    })
    .select<Array<{ contact_name_id: string; email: string | null; full_name: string | null }>>(
      'contact_name_id',
      'email',
      'full_name'
    );

  const localPart = (email: string | null | undefined): string | null => {
    const value = String(email ?? '').trim().toLowerCase();
    const at = value.indexOf('@');
    return at > 0 ? value.slice(0, at) : null;
  };

  if (normalized.email) {
    const byEmail = candidates.filter(
      (contact) => String(contact.email ?? '').trim().toLowerCase() === normalized.email
    );
    if (byEmail.length === 1) return { contactId: byEmail[0].contact_name_id, method: 'email' };
    if (byEmail.length > 1) return null;
  }

  const byUsername = candidates.filter((contact) => localPart(contact.email) === normalized.username);
  if (byUsername.length === 1) return { contactId: byUsername[0].contact_name_id, method: 'username' };
  if (byUsername.length > 1) return null;

  const byName = candidates.filter(
    (contact) => String(contact.full_name ?? '').trim().toLowerCase() === normalized.username
  );
  if (byName.length === 1) return { contactId: byName[0].contact_name_id, method: 'name' };

  return null;
}

/**
 * FR-D3: what sync does with a matched signed-in user, per RMM organization.
 * Defined in the import-free sibling so client components can read it without
 * pulling this module's `@alga-psa/db` graph; re-exported for server callers.
 */
export {
  RMM_CONTACT_ASSIGNMENT_MODES,
  isRmmContactAssignmentMode,
  type RmmContactAssignmentMode,
} from './contactAssignmentModes';
