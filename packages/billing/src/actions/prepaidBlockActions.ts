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
import type {
  IContractLinePrepaidBlock,
  IContractTemplateLinePrepaidBlock,
  ContractLineBlockIssuanceTriggerKind,
  HourBlockStatus,
} from '@alga-psa/types';
import {
  loadCoveredServicesWithHourlyRates,
  removeContractLinePrepaidBlockInTransaction,
  removeTemplateLinePrepaidBlockInTransaction,
  resolveContractLineDisplayKinds,
  upsertContractLinePrepaidBlockInTransaction,
  upsertTemplateLinePrepaidBlockInTransaction,
  type PrepaidBlockConfigInput,
  type PrepaidBlockConfigWarning,
} from '../services/prepaidBlockConfigService';
import { supersedeScheduledExpiryForManualIssue } from '../services/prepaidBlockLifecycleService';

/**
 * Prepaid Block contract-line actions (MSP-initiated).
 */

export type PrepaidBlockActionError = ActionMessageError | ActionPermissionError;

export type UpsertContractLinePrepaidBlockResult = {
  config: IContractLinePrepaidBlock;
  warnings: PrepaidBlockConfigWarning[];
};

function prepaidBlockActionErrorFrom(error: unknown): PrepaidBlockActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) return permissionError(error.message);
    if (error.message.startsWith('Cannot')) return actionError(error.message);
  }
  const code = (error as { code?: string })?.code;
  if (code === '23505') return actionError('A conflicting prepaid block record already exists. Please refresh and try again.');
  if (code === '23503') return actionError('A referenced service or contract line no longer exists. Please refresh and try again.');
  if (code === '23514') return actionError('One of the prepaid block values is not allowed. Please review the form and try again.');
  return null;
}

/**
 * Create or replace a Hourly line's Prepaid Block config (plan section 7).
 * Validation and the issuance sync live in prepaidBlockConfigService so the
 * custom-line, preset-copy and this action share one path. Risk 1 warnings
 * (a covered service also on another active line for the client) are returned,
 * not thrown.
 */
export const upsertContractLinePrepaidBlock = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  config: PrepaidBlockConfigInput,
): Promise<UpsertContractLinePrepaidBlockResult | PrepaidBlockActionError> => {
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        throw new Error('Permission denied: Cannot configure prepaid blocks');
      }
      return upsertContractLinePrepaidBlockInTransaction(trx, tenant, contractLineId, config);
    });
  } catch (error) {
    const expected = prepaidBlockActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/** Remove a line's Prepaid Block config. Scheduled issuances are cancelled; block history is kept. */
export const removeContractLinePrepaidBlock = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
): Promise<{ removed: boolean } | PrepaidBlockActionError> => {
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        throw new Error('Permission denied: Cannot configure prepaid blocks');
      }
      return removeContractLinePrepaidBlockInTransaction(trx, tenant, contractLineId);
    });
  } catch (error) {
    const expected = prepaidBlockActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export type TemplateLinePrepaidBlockView = {
  template_line_id: string;
  config: IContractTemplateLinePrepaidBlock | null;
  services: Array<{ service_id: string; service_name: string }>;
};

/** A template line's block config plus its services (for the sold-as picker). */
export const getTemplateLinePrepaidBlock = withAuth(async (
  user,
  { tenant },
  templateLineId: string,
): Promise<TemplateLinePrepaidBlockView | PrepaidBlockActionError> => {
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'read', trx)) {
        throw new Error('Permission denied: Cannot view prepaid blocks');
      }
      const db = tenantDb(trx, tenant);
      const config = await db.table('contract_template_line_prepaid_blocks')
        .where({ template_line_id: templateLineId })
        .first() as IContractTemplateLinePrepaidBlock | undefined;
      const query = db.table('contract_template_line_services as tls');
      db.tenantJoin(query, 'service_catalog as sc', 'sc.service_id', 'tls.service_id', { type: 'left' });
      const rows = await (query as any)
        .where('tls.template_line_id', templateLineId)
        .orderBy('tls.display_order', 'asc')
        .select('tls.service_id as service_id', 'sc.service_name as service_name') as Array<{ service_id: string; service_name: string | null }>;
      return {
        template_line_id: templateLineId,
        config: config ?? null,
        services: rows.map((r) => ({ service_id: r.service_id, service_name: r.service_name ?? r.service_id })),
      };
    });
  } catch (error) {
    const expected = prepaidBlockActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/** Create or replace a template line's Prepaid Block config (templates are currency-neutral). */
export const upsertTemplateLinePrepaidBlock = withAuth(async (
  user,
  { tenant },
  templateLineId: string,
  config: PrepaidBlockConfigInput,
): Promise<{ saved: true } | PrepaidBlockActionError> => {
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        throw new Error('Permission denied: Cannot configure prepaid blocks');
      }
      await upsertTemplateLinePrepaidBlockInTransaction(trx, tenant, templateLineId, config);
      return { saved: true as const };
    });
  } catch (error) {
    const expected = prepaidBlockActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const removeTemplateLinePrepaidBlock = withAuth(async (
  user,
  { tenant },
  templateLineId: string,
): Promise<{ removed: boolean } | PrepaidBlockActionError> => {
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        throw new Error('Permission denied: Cannot configure prepaid blocks');
      }
      return removeTemplateLinePrepaidBlockInTransaction(trx, tenant, templateLineId);
    });
  } catch (error) {
    const expected = prepaidBlockActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export type ContractLinePrepaidBlockSummary = {
  contract_line_id: string;
  /** Derived label kind: 'PrepaidBlock' for configured lines, else the stored type. */
  display_kind: string;
  config: IContractLinePrepaidBlock | null;
  /** contracts.currency_code of the line's contract (never defaulted). */
  currency_code: string | null;
  covered_services: Array<{ service_id: string; service_name: string; hourly_rate: number }>;
  /** Usable (active, unexpired) block balance across the line's blocks. */
  balance: { total_minutes: number; remaining_minutes: number; active_block_count: number };
  pending_block: {
    block_id: string;
    total_minutes: number;
    invoice_id: string | null;
    invoice_number: string | null;
    created_at: string;
    age_days: number;
    /** Minutes already logged against the pending block and held from overage billing. */
    held_minutes: number;
  } | null;
  next_issuance: {
    issuance_id: string;
    trigger_kind: ContractLineBlockIssuanceTriggerKind;
    due_date: string;
  } | null;
  history: Array<{
    block_id: string;
    status: HourBlockStatus;
    total_minutes: number;
    remaining_minutes: number;
    purchase_amount: number;
    currency_code: string;
    expiration_date: string | null;
    purchased_at: string | null;
    created_at: string;
    invoice_id: string | null;
    invoice_number: string | null;
    trigger_kind: ContractLineBlockIssuanceTriggerKind | null;
  }>;
};

const SUMMARY_HISTORY_LIMIT = 50;

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Everything the line card's Prepaid Block panel shows: config, usable balance,
 * pending block (with invoice link, age and held minutes), next scheduled
 * issuance and block history joined to invoices and issuances.
 */
export const getContractLinePrepaidBlockSummary = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
): Promise<ContractLinePrepaidBlockSummary | PrepaidBlockActionError> => {
  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'read', trx)) {
        throw new Error('Permission denied: Cannot read prepaid blocks');
      }
      const db = tenantDb(trx, tenant);

      const line = await db.table('contract_lines')
        .where({ contract_line_id: contractLineId })
        .first('contract_line_id', 'contract_id', 'contract_line_type');
      if (!line) throw new Error('Cannot load prepaid block summary: contract line not found');
      const contract = await db.table('contracts').where({ contract_id: line.contract_id }).first('currency_code');
      const config = await db.table('contract_line_prepaid_blocks')
        .where({ contract_line_id: contractLineId })
        .first() as IContractLinePrepaidBlock | undefined;
      const displayKinds = await resolveContractLineDisplayKinds(trx, tenant, [line]);

      const today = new Date().toISOString().slice(0, 10);
      const blockQuery = db.table('hour_blocks as hb');
      db.tenantJoin(blockQuery, 'invoices as inv', 'inv.invoice_id', 'hb.source_invoice_id', { type: 'left' });
      db.tenantJoin(blockQuery, 'contract_line_block_issuances as iss', 'iss.issuance_id', 'hb.issuance_id', { type: 'left' });
      const blocks = await (blockQuery as any)
        .where('hb.contract_line_id', contractLineId)
        .orderBy('hb.created_at', 'desc')
        .select(
          'hb.block_id', 'hb.status', 'hb.total_minutes', 'hb.remaining_minutes', 'hb.purchase_amount',
          'hb.currency_code', 'hb.expiration_date', 'hb.purchased_at', 'hb.created_at',
          'hb.source_invoice_id as invoice_id', 'inv.invoice_number as invoice_number',
          'iss.trigger_kind as trigger_kind',
        ) as Array<Record<string, any>>;

      // The balance is the block currently being drawn. A drained block keeps status 'active' until it
      // is replaced, so it must not be added to the follow-on's total ("37 h of 80 h"). With nothing
      // left anywhere, show the newest active block (0 h of its total).
      const activeBlocks = blocks.filter((block) => {
        const expiration = dateOnly(block.expiration_date);
        return block.status === 'active' && (!expiration || expiration >= today);
      });
      const drawable = activeBlocks.filter((block) => Number(block.remaining_minutes) > 0);
      const balanceBlocks = drawable.length > 0 ? drawable : activeBlocks.slice(0, 1);
      const activeCount = balanceBlocks.length;
      const totalMinutes = balanceBlocks.reduce((sum, block) => sum + Number(block.total_minutes), 0);
      const remainingMinutes = balanceBlocks.reduce((sum, block) => sum + Number(block.remaining_minutes), 0);

      const pendingRow = blocks.find((b) => b.status === 'pending');
      let pendingBlock: ContractLinePrepaidBlockSummary['pending_block'] = null;
      if (pendingRow) {
        const held = await db.table('hour_block_time_allocations')
          .where({ block_id: pendingRow.block_id })
          .sum<{ minutes: string | null }>('minutes as minutes')
          .first();
        const createdAt = isoOrNull(pendingRow.created_at) as string;
        pendingBlock = {
          block_id: pendingRow.block_id,
          total_minutes: Number(pendingRow.total_minutes),
          invoice_id: pendingRow.invoice_id ?? null,
          invoice_number: pendingRow.invoice_number ?? null,
          created_at: createdAt,
          age_days: Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)),
          held_minutes: Number(held?.minutes ?? 0),
        };
      }

      const nextIssuance = await db.table('contract_line_block_issuances')
        .where({ contract_line_id: contractLineId, status: 'scheduled' })
        .orderBy('due_date', 'asc')
        .first('issuance_id', 'trigger_kind', 'due_date');

      const covered = await loadCoveredServicesWithHourlyRates(trx, tenant, contractLineId);

      return {
        contract_line_id: contractLineId,
        display_kind: displayKinds.get(contractLineId) ?? line.contract_line_type,
        config: config ?? null,
        currency_code: contract?.currency_code ?? null,
        covered_services: covered,
        balance: { total_minutes: totalMinutes, remaining_minutes: remainingMinutes, active_block_count: activeCount },
        pending_block: pendingBlock,
        next_issuance: nextIssuance
          ? { issuance_id: nextIssuance.issuance_id, trigger_kind: nextIssuance.trigger_kind, due_date: dateOnly(nextIssuance.due_date) as string }
          : null,
        history: blocks.slice(0, SUMMARY_HISTORY_LIMIT).map((b) => ({
          block_id: b.block_id,
          status: b.status,
          total_minutes: Number(b.total_minutes),
          remaining_minutes: Number(b.remaining_minutes),
          purchase_amount: Number(b.purchase_amount),
          currency_code: b.currency_code,
          expiration_date: dateOnly(b.expiration_date),
          purchased_at: isoOrNull(b.purchased_at),
          created_at: isoOrNull(b.created_at) as string,
          invoice_id: b.invoice_id ?? null,
          invoice_number: b.invoice_number ?? null,
          trigger_kind: b.trigger_kind ?? null,
        })),
      };
    });
  } catch (error) {
    const expected = prepaidBlockActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

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
        .first('issuance_id', 'trigger_kind');
      // A scheduled expiry issuance is a date obligation, not a follow-on: a manual block may replace it.
      // (Renewal issuances are not created on this branch yet; if one appears it is still rejected here.)
      if (open && open.trigger_kind !== 'expiry') {
        throw new Error('Cannot issue a block: a next block is already scheduled for this line');
      }
      const pending = await db.table('hour_blocks')
        .where({ contract_line_id: contractLineId, status: 'pending' })
        .first('block_id');
      if (pending) {
        throw new Error('Cannot issue a block: a pending block is already awaiting invoice finalization');
      }

      // Supersede first so the one-scheduled-per-line index is never violated by the insert below.
      const replaced = open
        ? await supersedeScheduledExpiryForManualIssue(trx, tenant, contractLineId)
        : { superseded: false, sourceBlockId: null };

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
        // Restore key: voiding this manual block puts the superseded expiry issuance back.
        source_block_id: replaced.sourceBlockId,
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
