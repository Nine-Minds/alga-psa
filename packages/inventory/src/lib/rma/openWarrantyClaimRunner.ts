import type { Knex } from 'knex';
import type { z } from 'zod';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { authorizeTicketRecordAccess } from '@alga-psa/authorization/ticketRecordAuthorization';
import type { IRmaCase } from '@alga-psa/types';
import { rmaCaseQuery } from '../rmaCaseQuery';
import { openWarrantyClaimCore, type AuthorizeTicket } from './warrantyTransitions';
import type { OpenWarrantyClaimInput } from './warrantySchemas';
import { assetGate, requireWarrantyPerm, validationActionError, withWarrantyErrors, type WarrantyActionError } from './warrantyRunner';
import { publishRmaUpdated, publishWarrantyClaimOpened } from './publishRmaUpdated';

/**
 * The one orchestration for opening a warranty claim: permission, Zod parse, transaction with the asset gate and the
 * REQUIRED ticket authorizer, post-commit publishes, reload. Not a 'use server' module on purpose: it takes the
 * schema and the authorizer as parameters, so it must never be callable from a browser. Server actions call it with
 * the schema they allow (`openWarrantyClaimSchema` has no `ticket_id`) and the authorizer they can provide.
 */

/**
 * The default ticket authorizer for layers that cannot see `@alga-psa/tickets`: coarse `ticket:read` RBAC plus the
 * per-record policy (the kernel's RBAC hook is a no-op, so the coarse check must be explicit here). Any failure is
 * turned into "Ticket not found." by the core.
 */
export function ticketRecordAuthorizer(user: any, tenant: string): AuthorizeTicket {
  return async (trx, ticketId, action) => {
    if (!(await hasPermission(user, 'ticket', action))) throw new Error('Permission denied: Cannot read tickets');
    await authorizeTicketRecordAccess({ trx, tenant, user, ticketId, action });
  };
}

export async function openWarrantyClaimFlow(
  user: { user_id: string } & Record<string, any>,
  tenant: string,
  rawInput: unknown,
  schema: z.ZodType<OpenWarrantyClaimInput>,
  authorizeTicket: AuthorizeTicket
): Promise<IRmaCase | WarrantyActionError> {
  return withWarrantyErrors(async () => {
    await requireWarrantyPerm(user, 'create');
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) return validationActionError(parsed.error);
    const input: OpenWarrantyClaimInput = parsed.data;
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) =>
      openWarrantyClaimCore(trx, tenant, user.user_id, input, { authorizeAsset: await assetGate(trx, tenant, user), authorizeTicket })
    );
    await publishWarrantyClaimOpened(tenant, result.rma, result.serialNumber);
    await publishRmaUpdated(tenant, result.rma, null, ['status'], user.user_id);
    const row = await withTransaction(db, (trx: Knex.Transaction) =>
      rmaCaseQuery(trx, tenant).andWhere({ 'r.rma_id': result.rma.rma_id }).first()
    );
    return (row as IRmaCase | undefined) ?? result.rma;
  });
}
