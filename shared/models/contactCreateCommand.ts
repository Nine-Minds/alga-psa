import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IContact, IUser } from '@alga-psa/types';
import { assertRecordCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
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
  { tenant, actor, clientId }: { tenant: string; actor: ContactCreateActor; clientId: string | null | undefined },
): Promise<void> {
  if (!(await hasPermission(actor, 'contact', 'create', trx))) {
    throw new Error('Permission denied: Cannot create contacts');
  }

  await assertRecordCreateAllowed(trx, {
    tenant,
    user: actor,
    resourceType: 'contact',
    record: { clientId: clientId ?? null },
  }, 'contact');
}

/**
 * The one actor-initiated contact create. Everything runs in the caller's transaction, in this order:
 *
 *   1. RBAC `contact:create` for the actor.
 *   2. Record-create authorization on the candidate's client (a null client is a real candidate).
 *   3. Tenant-wide duplicate lookup.
 *   4. Insert through `ContactModel.createContact`.
 *   5. The contact-created event, queued to publish after commit.
 *
 * The scope check precedes the duplicate lookup so that a caller who may not create here is never told
 * whether an email exists. Edition-neutral: nothing here reaches into `ee/`; a tenant with nothing to
 * narrow costs the kernel's single cached tenant probe.
 */
export async function createContactAs(
  trx: Knex.Transaction,
  { tenant, actor, input }: CreateContactAsParams,
): Promise<IContact> {
  await assertContactCreateAllowed(trx, { tenant, actor, clientId: input.client_id });

  const email = input.email?.trim().toLowerCase();
  if (email) {
    const existing = await tenantDb(trx, tenant).table('contacts').where('email', email).first('contact_name_id');
    if (existing) {
      throw new Error(CONTACT_EMAIL_EXISTS_MESSAGE);
    }
  }

  const created = await ContactModel.createContact(input, tenant, trx);
  queueContactCreated(trx, tenant, created as any, { actorUserId: actor.user_id });
  return created;
}
