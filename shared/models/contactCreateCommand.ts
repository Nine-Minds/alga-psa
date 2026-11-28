import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IContact, IUser } from '@alga-psa/types';
import { assertRecordCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import { hasPermission } from '@alga-psa/authorization/rbac';
import { ContactModel, type CreateContactInput } from './contactModel';
import { queueContactCreated } from '../lib/contacts/contactEvents';

/** The caller's identity, as the authorization kernel and RBAC read it. */
export type ContactCreateActor = Parameters<typeof assertRecordCreateAllowed>[1]['user'] &
  Pick<IUser, 'user_id' | 'user_type'> & { tenant?: string };

export interface CreateContactAsParams {
  tenant: string;
  actor: ContactCreateActor;
  input: CreateContactInput;
  /**
   * Replaces step 1 (RBAC `contact:create`) for an actor whose right to create is not `contact:create`: the
   * client portal user, whose right is `user:create` on their own client. It must throw to refuse. Everything
   * after it (record-create authorization, the scope-projected duplicate check) is unchanged.
   */
  authorizeActor?: (trx: Knex.Transaction) => Promise<void>;
}

/** The one stable code of the generic duplicate-email result. S3, S4 and S6 match on this. */
export const CONTACT_EMAIL_IN_USE_CODE = 'CONTACT_EMAIL_IN_USE';

/**
 * The generic duplicate-email message: no client, no contact, and the same text whether the holder is outside
 * the caller's read scope or has no client. It keeps the `EMAIL_EXISTS:` prefix existing callers match on.
 */
export const CONTACT_EMAIL_IN_USE_MESSAGE = 'EMAIL_EXISTS: This email address is already in use';

/** Thrown when the email is held by a contact the caller may not be told about. Carries nothing but the code. */
export class ContactEmailInUseError extends Error {
  readonly code = CONTACT_EMAIL_IN_USE_CODE;
  constructor() {
    super(CONTACT_EMAIL_IN_USE_MESSAGE);
    this.name = 'ContactEmailInUseError';
  }
}

export function isContactEmailInUseError(error: unknown): error is ContactEmailInUseError {
  return error instanceof Error && (error as { code?: unknown }).code === CONTACT_EMAIL_IN_USE_CODE;
}

/** Same text the contact model uses, so every caller's EMAIL_EXISTS mapping keeps working. */
export const CONTACT_EMAIL_EXISTS_MESSAGE =
  'EMAIL_EXISTS: A contact with this email address already exists in the system';

/**
 * Steps 1 and 2 of the command: RBAC `contact:create`, then record-create authorization on the candidate's
 * client (a null client is a real candidate). `createContactAs` runs this first; it is exported only for the
 * one caller that has to answer "may this actor create here?" before it can report anything about existing
 * contacts (the CSV import's duplicate report), so no path carries its own copy of the gate.
 */
export async function assertContactCreateAllowed(
  trx: Knex.Transaction,
  {
    tenant,
    actor,
    clientId,
    authorizeActor,
  }: {
    tenant: string;
    actor: ContactCreateActor;
    clientId: string | null | undefined;
    authorizeActor?: CreateContactAsParams['authorizeActor'];
  },
): Promise<void> {
  if (authorizeActor) {
    await authorizeActor(trx);
  } else if (!(await hasPermission(actor, 'contact', 'create', trx))) {
    throw new Error('Permission denied: Cannot create contacts');
  }

  await assertRecordCreateAllowed(trx, {
    tenant,
    user: actor,
    resourceType: 'contact',
    record: { clientId: clientId ?? null },
  }, 'contact');
}

type EmailHolder = { contact_name_id: string; client_id: string | null };

async function findEmailHolder(
  trx: Knex.Transaction,
  tenant: string,
  email: string,
  { includeAdditional = false }: { includeAdditional?: boolean } = {},
): Promise<EmailHolder | undefined> {
  const primary = await tenantDb(trx, tenant).table('contacts').where('email', email).first('contact_name_id', 'client_id');
  if (primary || !includeAdditional) return primary;

  // Find-or-create has always matched a contact holding the address as an additional email too. Ids only here;
  // the holder is read in full only after the scope decision.
  const additional = await tenantDb(trx, tenant)
    .table('contact_additional_email_addresses')
    .where('normalized_email_address', email)
    .first<{ contact_name_id: string }>('contact_name_id');
  if (!additional) return undefined;
  return tenantDb(trx, tenant).table('contacts').where('contact_name_id', additional.contact_name_id).first('contact_name_id', 'client_id');
}

/**
 * Projects the holder of a duplicate email through the actor's contact read scope. A holder the actor can read
 * may be named or returned; any other (outside scope, or without a client once a rule narrows) is refused with
 * the one generic result, by the same branch, so the two cases cannot be told apart. A client-portal actor is
 * told about a holder only at the client they are acting for (their own); the scope context resolves internal
 * subjects only, so for them the own-client rule is the read scope.
 */
async function mayDiscloseHolder(
  trx: Knex.Transaction,
  tenant: string,
  actor: ContactCreateActor,
  holder: EmailHolder,
  targetClientId: string | null | undefined,
): Promise<boolean> {
  if (actor.user_type === 'client') return holder.client_id !== null && holder.client_id === targetClientId;
  const scope = await createClientScopeContext(trx, tenant, actor as any);
  return scope.permits('contact', holder.contact_name_id);
}

/**
 * The one actor-initiated contact create. Everything runs in the caller's transaction, in this order:
 *
 *   1. RBAC `contact:create` for the actor.
 *   2. Record-create authorization on the candidate's client (a null client is a real candidate).
 *   3. Tenant-wide duplicate lookup, projected through the actor's contact read scope.
 *   4. Insert through `ContactModel.createContact`.
 *   5. The contact-created event, queued to publish after commit.
 *
 * The scope check precedes the duplicate lookup so that a caller who may not create here is never told
 * whether an email exists, and the lookup's result is projected through read scope before anything of it
 * leaves: a holder outside scope yields `ContactEmailInUseError`, nothing else. Edition-neutral: nothing here
 * reaches into `ee/`; a tenant with nothing to narrow costs the kernel's single cached tenant probe.
 */
export async function createContactAs(
  trx: Knex.Transaction,
  { tenant, actor, input, authorizeActor }: CreateContactAsParams,
): Promise<IContact> {
  await assertContactCreateAllowed(trx, { tenant, actor, clientId: input.client_id, authorizeActor });

  const email = input.email?.trim().toLowerCase();
  if (email) {
    const holder = await findEmailHolder(trx, tenant, email);
    if (holder) {
      if (!(await mayDiscloseHolder(trx, tenant, actor, holder, input.client_id))) throw new ContactEmailInUseError();
      throw new Error(CONTACT_EMAIL_EXISTS_MESSAGE);
    }
  }

  return insertContact(trx, tenant, actor, input);
}

async function insertContact(
  trx: Knex.Transaction,
  tenant: string,
  actor: ContactCreateActor,
  input: CreateContactInput,
): Promise<IContact> {
  const created = await ContactModel.createContact(input, tenant, trx);
  queueContactCreated(trx, tenant, created as any, { actorUserId: actor.user_id });
  return created;
}

export interface FindOrCreateContactResult {
  contact: IContact & { client_name: string };
  isNew: boolean;
}

/**
 * Find-or-create by email: the same command, returning the existing contact instead of failing.
 *
 * Order: create gate (steps 1 and 2) -> id-only holder lookup -> read-scope decision -> only then is the holder
 * read in full, named or returned. A holder the actor cannot read throws `ContactEmailInUseError` before any
 * of its fields are fetched. A readable holder at the requested client is returned (`isNew: false`); a readable
 * holder elsewhere is refused naming its client, as the create path always did for unrestricted MSP users.
 */
export async function findOrCreateContactAs(
  trx: Knex.Transaction,
  { tenant, actor, input, authorizeActor }: CreateContactAsParams,
): Promise<FindOrCreateContactResult> {
  await assertContactCreateAllowed(trx, { tenant, actor, clientId: input.client_id, authorizeActor });

  const email = input.email?.trim().toLowerCase();
  if (email) {
    const holder = await findEmailHolder(trx, tenant, email, { includeAdditional: true });
    if (holder) {
      if (!(await mayDiscloseHolder(trx, tenant, actor, holder, input.client_id))) throw new ContactEmailInUseError();

      if (holder.client_id !== (input.client_id ?? null)) {
        if (!holder.client_id) {
          throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system without a client assignment');
        }
        const client = await tenantDb(trx, tenant)
          .table('clients')
          .where({ client_id: holder.client_id })
          .first<{ client_name: string }>('client_name');
        throw new Error(`EMAIL_EXISTS: This email is already associated with ${client?.client_name || 'another client'}`);
      }

      const existing = await ContactModel.getContactByEmail(email, tenant, trx);
      if (existing) {
        return { contact: { ...existing, client_name: (existing as any).client_name || '' }, isNew: false };
      }
    }
  }

  const created = await insertContact(trx, tenant, actor, input);
  const client = input.client_id
    ? await tenantDb(trx, tenant).table('clients').where({ client_id: input.client_id }).first<{ client_name: string }>('client_name')
    : undefined;
  return { contact: { ...created, client_name: client?.client_name || '' }, isNew: true };
}
