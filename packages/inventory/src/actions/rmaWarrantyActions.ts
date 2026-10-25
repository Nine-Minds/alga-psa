'use server';

import type { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IRmaCase } from '@alga-psa/types';
import {
  approveWarrantyClaimCore, approveWarrantyClaimSchema, assetGate, cancelWarrantyClaimCore, cancelWarrantyClaimSchema,
  closeWarrantyRmaCore, closeWarrantyRmaSchema, denyWarrantyClaimCore, denyWarrantyClaimSchema, markDeviceReceivedCore,
  markDeviceReceivedSchema, openWarrantyClaimCore, openWarrantyClaimSchema, publishWarrantyClaimOpened, publishRmaUpdated,
  receiveVendorReplacementCore, receiveVendorReplacementSchema, recordVendorCreditCore, recordVendorCreditSchema,
  recordVendorRepairCore, recordVendorRepairSchema, requireWarrantyPerm, returnDeviceToClientCore, returnDeviceToClientSchema,
  runWarrantyTransition, shipToVendorCore, shipToVendorSchema, withWarrantyErrors, type WarrantyActionError,
} from '../lib/rma';
import { rmaCaseQuery } from '../lib/rmaCaseQuery';
import type { z } from 'zod';

/**
 * Warranty review and RMA for client-owned equipment (C5). Every action here is a thin shell: permission check,
 * Zod parse, then a transaction-taking core from `lib/rma/warrantyTransitions.ts`. None of them touches stock.
 * Refusals come back as values (`{actionError}`), never thrown.
 */

type Result = IRmaCase | WarrantyActionError;

async function reload(tenant: string, rmaId: string, fallback: IRmaCase): Promise<IRmaCase> {
  const { knex: db } = await createTenantKnex();
  const row = await withTransaction(db, (trx: Knex.Transaction) => rmaCaseQuery(trx, tenant).andWhere({ 'r.rma_id': rmaId }).first());
  return (row as IRmaCase | undefined) ?? fallback;
}

function transition<S extends z.ZodTypeAny>(
  schema: S,
  core: (trx: Knex.Transaction, tenant: string, actor: string, rmaId: string, input: z.output<S>, options: { authorizeAsset: (a: string, c: string | null) => Promise<void> }) => Promise<import('../lib/rma').WarrantyTransitionResult>
) {
  return withAuth(async (user, { tenant }, rmaId: string, rawInput: unknown): Promise<Result> =>
    withWarrantyErrors(async () => {
      await requireWarrantyPerm(user, 'update');
      const input = schema.parse(rawInput ?? {});
      const result = await runWarrantyTransition(user as any, tenant, (trx, authorizeAsset) =>
        core(trx, tenant, user.user_id, rmaId, input, { authorizeAsset })
      );
      return reload(tenant, rmaId, result.rma);
    })
  );
}

export const openWarrantyClaim = withAuth(async (user, { tenant }, rawInput: unknown): Promise<Result> =>
  withWarrantyErrors(async () => {
    await requireWarrantyPerm(user, 'create');
    const input = openWarrantyClaimSchema.parse(rawInput);
    const { knex: db } = await createTenantKnex();
    const result = await withTransaction(db, async (trx: Knex.Transaction) =>
      openWarrantyClaimCore(trx, tenant, user.user_id, input, { authorizeAsset: await assetGate(trx, tenant, user as any) })
    );
    await publishWarrantyClaimOpened(tenant, result.rma, result.serialNumber);
    await publishRmaUpdated(tenant, result.rma, null, ['status'], user.user_id);
    return reload(tenant, result.rma.rma_id, result.rma);
  })
);

export const approveWarrantyClaim = transition(approveWarrantyClaimSchema, approveWarrantyClaimCore);
export const denyWarrantyClaim = transition(denyWarrantyClaimSchema, denyWarrantyClaimCore);
export const cancelWarrantyClaim = transition(cancelWarrantyClaimSchema, cancelWarrantyClaimCore);
export const markDeviceReceived = transition(markDeviceReceivedSchema, markDeviceReceivedCore);
export const shipToVendor = transition(shipToVendorSchema, shipToVendorCore);
export const receiveVendorReplacement = transition(receiveVendorReplacementSchema, receiveVendorReplacementCore);
export const recordVendorRepair = transition(recordVendorRepairSchema, recordVendorRepairCore);
export const recordVendorCredit = transition(recordVendorCreditSchema, recordVendorCreditCore);
export const returnDeviceToClient = transition(returnDeviceToClientSchema, returnDeviceToClientCore);
export const closeWarrantyRma = transition(closeWarrantyRmaSchema, closeWarrantyRmaCore);
