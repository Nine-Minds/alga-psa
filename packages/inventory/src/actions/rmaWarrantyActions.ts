'use server';

import type { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IRmaCase, IRmaEvent } from '@alga-psa/types';
import { createAssetReadContext, filterReadableAssets } from '@alga-psa/assets/lib/assetReadAuthorization';
import { getOpenCustodyForAssets } from '@alga-psa/assets/lib/custody/queries';
import {
  approveWarrantyClaimCore, approveWarrantyClaimSchema, assetGate, cancelWarrantyClaimCore, cancelWarrantyClaimSchema,
  closeWarrantyRmaCore, closeWarrantyRmaSchema, denyWarrantyClaimCore, denyWarrantyClaimSchema, markDeviceReceivedCore,
  markDeviceReceivedSchema, openWarrantyClaimCore, openWarrantyClaimSchema, publishWarrantyClaimOpened, publishRmaUpdated,
  receiveVendorReplacementCore, receiveVendorReplacementSchema, recordVendorCreditCore, recordVendorCreditSchema,
  recordVendorRepairCore, recordVendorRepairSchema, requireWarrantyPerm, returnDeviceToClientCore, returnDeviceToClientSchema,
  runWarrantyTransition, shipToVendorCore, resolveRmaReadScope, filterReadableRmaCases, listRmaEvents as listRmaEventRows, shipToVendorSchema, validationActionError, withWarrantyErrors, type WarrantyActionError,
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
      const parsed = schema.safeParse(rawInput ?? {});
      if (!parsed.success) return validationActionError(parsed.error);
      const input = parsed.data;
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
    const parsed = openWarrantyClaimSchema.safeParse(rawInput);
    if (!parsed.success) return validationActionError(parsed.error);
    const input = parsed.data;
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

/** A history row with the actor's display name joined, for the RMA timeline. */
export type IRmaEventView = IRmaEvent & { actor_name: string | null };

/**
 * The append-only history of one case, oldest first. Gated like `getRmaCase`: a case the caller cannot read
 * (permission, stock-unit scope, or the asset record check) yields an empty list. Read-only.
 */
export const listRmaCaseEvents = withAuth(async (user, { tenant }, rmaId: string): Promise<IRmaEventView[] | WarrantyActionError> =>
  withWarrantyErrors(async () => {
    const scope = await resolveRmaReadScope(user);
    if (!scope.allowed) return [];
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const row = await trx('rma_cases').where({ tenant, rma_id: rmaId }).select('rma_id', 'asset_id', 'client_id', 'returned_unit_id').first();
      if (!row) return [];
      const visible = await filterReadableRmaCases(trx, tenant, user, [row], scope);
      if (visible.length === 0) return [];
      const events = await listRmaEventRows(trx, tenant, rmaId);
      const actorIds = [...new Set(events.map((e) => e.actor_user_id).filter((id): id is string => !!id))];
      const names = new Map<string, string>();
      if (actorIds.length > 0) {
        const users = await trx('users').where({ tenant }).whereIn('user_id', actorIds).select('user_id', 'first_name', 'last_name');
        for (const u of users) {
          const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
          if (name) names.set(u.user_id, name);
        }
      }
      return events.map((e) => ({ ...e, actor_name: e.actor_user_id ? names.get(e.actor_user_id) ?? null : null }));
    });
  })
);

export interface IClaimableAsset {
  asset_id: string;
  name: string;
  asset_tag: string | null;
  serial_number: string | null;
  client_name: string | null;
  in_custody: boolean;
}

const CLAIMABLE_ASSET_LIMIT = 50;

/**
 * Client-owned assets the caller may open a warranty claim against (no stock unit, not MSP-owned), narrowed by
 * the asset record check. `search` matches name, tag or serial. Read-only; capped for the picker.
 */
export const listClaimableAssets = withAuth(async (user, { tenant }, search?: string): Promise<IClaimableAsset[] | WarrantyActionError> =>
  withWarrantyErrors(async () => {
    await requireWarrantyPerm(user, 'create');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('assets as a')
        .leftJoin('clients as c', function () {
          this.on('a.client_id', '=', 'c.client_id').andOn('a.tenant', '=', 'c.tenant');
        })
        .where({ 'a.tenant': tenant })
        .whereNull('a.stock_unit_id')
        .andWhere('a.ownership', '<>', 'msp')
        .select('a.asset_id', 'a.name', 'a.asset_tag', 'a.serial_number', 'a.client_id', 'c.client_name')
        .orderBy('a.name', 'asc')
        .limit(CLAIMABLE_ASSET_LIMIT * 2);
      const term = search?.trim();
      if (term) {
        const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
        q.andWhere((w) => w.whereILike('a.name', like).orWhereILike('a.asset_tag', like).orWhereILike('a.serial_number', like));
      }
      const rows = await q;
      const ctx = await createAssetReadContext(trx, tenant, user as any);
      const readable = (await filterReadableAssets(trx, tenant, ctx, rows.map((r: any) => ({ asset_id: r.asset_id, client_id: r.client_id ?? null })))).slice(0, CLAIMABLE_ASSET_LIMIT);
      const keep = new Set(readable.map((a) => a.asset_id));
      const kept = rows.filter((r: any) => keep.has(r.asset_id)).slice(0, CLAIMABLE_ASSET_LIMIT);
      const custody = await getOpenCustodyForAssets(trx, tenant, kept.map((r: any) => r.asset_id));
      return kept.map((r: any): IClaimableAsset => ({
        asset_id: r.asset_id,
        name: r.name,
        asset_tag: r.asset_tag ?? null,
        serial_number: r.serial_number ?? null,
        client_name: r.client_name ?? null,
        in_custody: custody.has(r.asset_id),
      }));
    });
  })
);
