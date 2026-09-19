'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { CoManagedSlaSetupError, getCoManagedTicketEditor, searchCoManagedTicketEditOptions, editCoManagedTicket,
  CoManagedTicketEditError, CoManagedSharedWorkError, type CoManagedSharedResource, type CoManagedTicketEditRequest,
  type CoManagedTicketEditReceipt } from '@alga-psa/co-managed';
import { updateTicketInTransaction } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { TicketCloseValidationError } from '@alga-psa/tickets/lib/validateTicketClosure';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getSharedTicketEditorAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketEditor(knex, actor, resource);
});

export const searchSharedTicketEditOptionsAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  input: { field: 'status_id' | 'priority_id'; search?: string; afterId?: string }) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return searchCoManagedTicketEditOptions(knex, actor, resource, input);
});

export type SharedTicketEditResult = { ok: true; receipt: CoManagedTicketEditReceipt } |
  { ok: false; code: 'invalid' | 'conflict' | 'operationConflict' | 'forbidden' | 'readOnly' | 'closeRules' | 'slaSetupRequired' | 'unknownOutcome' };

export const saveSharedTicketEditAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  request: CoManagedTicketEditRequest): Promise<SharedTicketEditResult> => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const receipt = await editCoManagedTicket(knex, actor, resource, request, async (context, patch) => {
      await updateTicketInTransaction(context.trx, user, context.resource.tenant, context.resource.id, patch, undefined, {
        actorReferenceId: context.actorReferenceId, assertWriteAuthority: context.assertWriteAuthority,
      });
    });
    return { ok: true, receipt };
  } catch (error) {
    if (error instanceof CoManagedSlaSetupError) return { ok: false, code: 'slaSetupRequired' };
    if (error instanceof CoManagedSharedWorkError) return { ok: false, code: 'forbidden' };
    if (error instanceof CoManagedLifecycleError) return { ok: false, code: 'readOnly' };
    if (error instanceof TicketCloseValidationError) return { ok: false, code: 'closeRules' };
    if (error instanceof CoManagedTicketEditError) return { ok: false, code: {
      INVALID_TICKET_EDIT: 'invalid', TICKET_EDIT_CONFLICT: 'conflict', TICKET_EDIT_OPERATION_CONFLICT: 'operationConflict',
    }[error.code] as 'invalid' | 'conflict' | 'operationConflict' };
    // A connection loss around COMMIT has an unknown outcome. Preserve the
    // request ID and baseline for an exact retry; do not promise a rollback.
    return { ok: false, code: 'unknownOutcome' };
  }
});
