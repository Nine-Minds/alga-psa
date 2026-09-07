'use server';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { previewCoManagedThreadDisclosure, CoManagedThreadDisclosureError, CoManagedSharedWorkError, type CoManagedSharedResource,
  type CoManagedThreadReference, type CoManagedThreadDisclosureRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { discloseSharedTicketThread } from '../co-managed/discloseTicketThread';
export const previewCoManagedThreadDisclosureAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, reference: CoManagedThreadReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return { preview: await previewCoManagedThreadDisclosure(knex, actor, resource, reference), actor: { tenant: actor.tenant, userId: actor.userId } };
});
export const discloseCoManagedThreadAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedThreadDisclosureRequest) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, receipt: await discloseSharedTicketThread(knex, actor, resource, request) };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' as const };
    if (error instanceof CoManagedLifecycleError) return { ok: false as const, code: 'readOnly' as const };
    if (error instanceof CoManagedThreadDisclosureError) return { ok: false as const, code: error.code === 'INVALID_THREAD_DISCLOSURE' ? 'invalid' as const
      : error.code === 'THREAD_DISCLOSURE_CONFLICT' ? 'conflict' as const : 'operationConflict' as const };
    return { ok: false as const, code: 'unknownOutcome' as const };
  }
});
