'use server';

import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * Prepaid Block contract-line actions (MSP-initiated).
 */

export type PrepaidBlockActionError = ActionMessageError | ActionPermissionError;

export type IssueNextPrepaidBlockResult = { issuanceId: string };

/**
 * Queues a 'manual' next-block issuance for a Prepaid Block line, due today.
 * The due-work runner turns it into a draft invoice exactly like any other
 * scheduled issuance. Refuses when the line already has an open follow-on
 * (a scheduled issuance or a pending contract block), so the MSP never
 * double-issues.
 *
 * Lock order: the line's config row first (serialises concurrent issues and
 * the replenishment path), then the issuance/block rows.
 */
export const issueNextPrepaidBlock = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
): Promise<IssueNextPrepaidBlockResult | PrepaidBlockActionError> => {
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        throw new Error('Permission denied: Cannot issue prepaid blocks');
      }
      const db = tenantDb(trx, tenant);

      const config = await db.table('contract_line_prepaid_blocks')
        .where({ contract_line_id: contractLineId })
        .forUpdate()
        .first('contract_line_id');
      if (!config) {
        throw new Error('Cannot issue a block: this contract line is not a Prepaid Block line');
      }

      const today = new Date().toISOString().slice(0, 10);
      const contractQuery = db.table('client_contracts as cc')
        .select('cc.client_contract_id', 'cc.client_id')
        .where({ 'cc.is_active': true })
        .where((b) => b.whereNull('cc.start_date').orWhere('cc.start_date', '<=', today))
        .where((b) => b.whereNull('cc.end_date').orWhere('cc.end_date', '>=', today));
      db.tenantJoin(contractQuery, 'contract_lines as cl', 'cl.contract_id', 'cc.contract_id');
      contractQuery.where('cl.contract_line_id', contractLineId);
      const [clientContract] = await contractQuery as Array<{ client_contract_id: string; client_id: string }>;
      if (!clientContract) {
        throw new Error('Cannot issue a block: the contract line has no active client contract');
      }

      const open = await db.table('contract_line_block_issuances')
        .where({ contract_line_id: contractLineId, status: 'scheduled' })
        .forUpdate()
        .first('issuance_id');
      if (open) {
        throw new Error('Cannot issue a block: a next block is already scheduled for this line');
      }
      const pending = await db.table('hour_blocks')
        .where({ contract_line_id: contractLineId, status: 'pending' })
        .first('block_id');
      if (pending) {
        throw new Error('Cannot issue a block: a pending block is already awaiting invoice finalization');
      }

      const issuanceId = uuidv4();
      await db.table('contract_line_block_issuances').insert({
        tenant,
        issuance_id: issuanceId,
        contract_line_id: contractLineId,
        client_contract_id: clientContract.client_contract_id,
        client_id: clientContract.client_id,
        trigger_kind: 'manual',
        due_date: today,
        status: 'scheduled',
      });
      return { issuanceId };
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith('Permission denied')) return permissionError(error.message);
      if (error.message.startsWith('Cannot')) return actionError(error.message);
    }
    if ((error as { code?: string })?.code === '23505') {
      return actionError('A next block is already scheduled for this line. Please refresh and try again.');
    }
    throw error;
  }
});
