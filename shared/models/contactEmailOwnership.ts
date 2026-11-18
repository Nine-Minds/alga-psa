/**
 * Who owns an email address in this tenant?
 *
 * Contact email uniqueness is tenant-wide and spans two tables: the primary
 * address on `contacts` and the extra addresses on
 * `contact_additional_email_addresses`. This is the one place that reads both
 * and answers with the owning contact and its client.
 *
 * It is a read-only lookup and makes NO permission decision: it returns ids
 * and names. A caller that shows the result to a user must decide, once, whether
 * that user may see the owning client (see `describeContactEmailConflict`).
 */
import type { Knex } from 'knex';
import { getConnection, tenantDb } from '@alga-psa/db';

export type ContactEmailOwnerKind = 'primary' | 'additional';

export interface ContactEmailOwner {
  /** Which address of the owning contact matched. */
  kind: ContactEmailOwnerKind;
  contactNameId: string;
  clientId: string | null;
  fullName: string;
  /** Null when the contact has no client. */
  clientName: string | null;
  isInactive: boolean;
}

interface OwnerRow {
  contact_name_id: string;
  client_id: string | null;
  full_name: string | null;
  is_inactive: boolean | null;
  client_name: string | null;
}

export function normalizeOwnershipEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toOwner(kind: ContactEmailOwnerKind, row: OwnerRow): ContactEmailOwner {
  return {
    kind,
    contactNameId: String(row.contact_name_id),
    clientId: row.client_id ? String(row.client_id) : null,
    fullName: row.full_name ? String(row.full_name) : '',
    clientName: row.client_name ? String(row.client_name) : null,
    isInactive: Boolean(row.is_inactive),
  };
}

export async function resolveContactEmailOwnership(
  tenantId: string,
  email: string,
  trx?: Knex.Transaction
): Promise<ContactEmailOwner | null> {
  const normalized = normalizeOwnershipEmail(email ?? '');
  if (!normalized) {
    return null;
  }

  const conn = trx ?? (await getConnection(tenantId));
  const db = tenantDb(conn, tenantId);

  const primary = await db
    .table('contacts as c')
    .leftJoin('clients as cl', function joinClient() {
      this.on('cl.client_id', '=', 'c.client_id').andOn('cl.tenant', '=', 'c.tenant');
    })
    .whereRaw('lower(c.email) = ?', [normalized])
    .orderBy('c.updated_at', 'desc')
    .first<OwnerRow>(['c.contact_name_id', 'c.client_id', 'c.full_name', 'c.is_inactive', 'cl.client_name']);

  if (primary) {
    return toOwner('primary', primary);
  }

  const additional = await db
    .table('contact_additional_email_addresses as cea')
    .join('contacts as c', function joinContact() {
      this.on('c.contact_name_id', '=', 'cea.contact_name_id').andOn('c.tenant', '=', 'cea.tenant');
    })
    .leftJoin('clients as cl', function joinClient() {
      this.on('cl.client_id', '=', 'c.client_id').andOn('cl.tenant', '=', 'c.tenant');
    })
    .where('cea.normalized_email_address', normalized)
    .first<OwnerRow>(['c.contact_name_id', 'c.client_id', 'c.full_name', 'c.is_inactive', 'cl.client_name']);

  return additional ? toOwner('additional', additional) : null;
}

export const EMAIL_EXISTS_PREFIX = 'EMAIL_EXISTS: ';
export const GENERIC_EMAIL_EXISTS_MESSAGE =
  `${EMAIL_EXISTS_PREFIX}A contact with this email address already exists in the system`;

/**
 * Thrown by `ContactModel` when an email is already owned. The message keeps the
 * `EMAIL_EXISTS: ` prefix and the generic text, so code that matches on the
 * string keeps working; `.conflict` carries the owner for callers that want to
 * say who it is.
 */
export class EmailOwnershipError extends Error {
  readonly conflict: ContactEmailOwner;

  constructor(conflict: ContactEmailOwner, message: string = GENERIC_EMAIL_EXISTS_MESSAGE) {
    super(message);
    this.name = 'EmailOwnershipError';
    this.conflict = conflict;
  }
}

export type ContactEmailConflictTranslate = (key: string, params?: Record<string, string>) => string;

/**
 * The one sentence every path shows when an email is already owned.
 *
 * `clientVisible` is the CALLER's decision (does this subject have read scope
 * over the owning contact and its client?). When it is false nothing about the
 * owner is named: not the client, and not the contact either, since "Jane at
 * an unnamed client" still discloses tenant structure.
 * Keys live in `msp/contacts` under `errors.contact.emailConflict`.
 */
export function describeContactEmailConflict(
  conflict: ContactEmailOwner,
  clientVisible: boolean,
  t: ContactEmailConflictTranslate
): string {
  const prefix = 'errors.contact.emailConflict';
  if (!clientVisible) {
    return t(`${prefix}.anotherClient`);
  }

  const name = conflict.fullName || conflict.clientName || '';
  const client = conflict.clientId ? conflict.clientName : null;

  if (conflict.kind === 'additional') {
    return client
      ? t(`${prefix}.additionalAtClient`, { name, client })
      : t(`${prefix}.additional`, { name });
  }
  if (conflict.isInactive) {
    return client
      ? t(`${prefix}.inactiveAtClient`, { name, client })
      : t(`${prefix}.inactive`, { name });
  }
  return client
    ? t(`${prefix}.named`, { name, client })
    : t(`${prefix}.namedNoClient`, { name });
}

/** Structural guard: survives a second copy of this module in a bundle, where `instanceof` would not. */
export function isEmailOwnershipError(error: unknown): error is EmailOwnershipError {
  if (error instanceof EmailOwnershipError) return true;
  const candidate = error as { name?: unknown; conflict?: unknown } | null | undefined;
  return (
    error instanceof Error &&
    candidate?.name === 'EmailOwnershipError' &&
    typeof candidate.conflict === 'object' &&
    candidate.conflict !== null
  );
}
