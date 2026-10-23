'use server';

import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  orderTicketCommentsNewestFirst,
  whereCustomerAuthoredComment,
} from '@alga-psa/shared/workflow/runtime/actions/businessOperations/ticketComments';

export type WorkflowContractOption = {
  contract_id: string;
  /** The client's assignment of the contract; date triggers fire per assignment. */
  client_contract_id: string | null;
  contract_name: string | null;
  client_id: string | null;
  client_name: string | null;
  start_date: string | null;
  /** The assignment's end date (client_contracts.end_date, what the Contract end trigger fires on). */
  end_date: string | null;
  decision_due_date: string | null;
  renewal_mode: string | null;
  renewal_cycle_key: string | null;
};

const toIsoDate = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

/**
 * Client contracts for the workflow designer's contract picker and the Run dialog's record fill:
 * just the ids, names, and dates, without the billing action module's pricing and invoice code.
 */
export const listWorkflowContractOptionsAction = withAuth(async (user, { tenant }): Promise<WorkflowContractOption[]> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'billing', 'read', knex)) {
    throw new Error('Permission denied: you need billing read access to choose a contract.');
  }

  const db = tenantDb(knex, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as co', 'co.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'clients as c', 'cc.client_id', 'c.client_id', { type: 'left' });

  const rows = await query
    .where((builder) => builder.whereNull('co.is_template').orWhere('co.is_template', false))
    .select(
      'co.contract_id',
      'cc.client_contract_id',
      'co.contract_name',
      'cc.client_id',
      'c.client_name',
      'cc.renewal_mode',
      'cc.renewal_cycle_key',
      // Calendar dates as written, never shifted by a timezone conversion.
      knex.raw('cc.start_date::text as start_date'),
      knex.raw('cc.end_date::text as end_date'),
      knex.raw('cc.decision_due_date::text as decision_due_date')
    )
    .orderBy('c.client_name', 'asc')
    .orderBy('co.contract_name', 'asc');

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    contract_id: String(row.contract_id),
    client_contract_id: (row.client_contract_id as string | null) ?? null,
    contract_name: (row.contract_name as string | null) ?? null,
    client_id: (row.client_id as string | null) ?? null,
    client_name: (row.client_name as string | null) ?? null,
    start_date: toIsoDate(row.start_date),
    end_date: toIsoDate(row.end_date),
    decision_due_date: toIsoDate(row.decision_due_date),
    renewal_mode: (row.renewal_mode as string | null) ?? null,
    renewal_cycle_key: (row.renewal_cycle_key as string | null) ?? null,
  }));
});

export type WorkflowAssetOption = {
  asset_id: string;
  asset_name: string | null;
  asset_tag: string | null;
  client_id: string | null;
  client_name: string | null;
  /** What the Asset warranty end trigger fires on. */
  warranty_end_date: string | null;
};

/** Assets for the asset picker and the Run dialog's record fill (Asset warranty end trigger). */
export const listWorkflowAssetOptionsAction = withAuth(async (user, { tenant }): Promise<WorkflowAssetOption[]> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'asset', 'read', knex)) {
    throw new Error('Permission denied: you need asset read access to choose an asset.');
  }
  const db = tenantDb(knex, tenant);
  const query = db.table('assets as a');
  db.tenantJoin(query, 'clients as c', 'a.client_id', 'c.client_id', { type: 'left' });
  const rows = await query
    .select('a.asset_id', 'a.name as asset_name', 'a.asset_tag', 'a.client_id', 'c.client_name', 'a.warranty_end_date')
    .orderBy('a.name', 'asc');
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    asset_id: String(row.asset_id),
    asset_name: (row.asset_name as string | null) ?? null,
    asset_tag: (row.asset_tag as string | null) ?? null,
    client_id: (row.client_id as string | null) ?? null,
    client_name: (row.client_name as string | null) ?? null,
    warranty_end_date: toIsoDate(row.warranty_end_date),
  }));
});

export type WorkflowClientSummary = {
  client_name: string | null;
  /** The Client anniversary trigger counts from client_since, else from created_at. */
  client_since: string | null;
  created_at: string | null;
};

/** A client's name and anniversary dates, for the Run dialog's record fill after a client is picked. */
export const getWorkflowClientSummaryAction = withAuth(async (user, { tenant }, clientId: string): Promise<WorkflowClientSummary | null> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'client', 'read', knex)) {
    throw new Error('Permission denied: you need client read access to look up a client.');
  }
  const row = await tenantDb(knex, tenant).table('clients').where('client_id', clientId)
    .first('client_name', knex.raw('client_since::text as client_since'), 'created_at');
  return row
    ? {
        client_name: (row.client_name as string | null) ?? null,
        client_since: toIsoDate(row.client_since),
        created_at: toIsoDate(row.created_at),
      }
    : null;
});

export type WorkflowTicketReplySummary = {
  /** The ticket's latest customer comment, else its latest comment. */
  comment_id: string;
  created_at: string | null;
  is_customer_reply: boolean;
};

/**
 * The ticket comment a test run should report as the message (TICKET_CUSTOMER_REPLIED and other
 * message events carry the comment id as messageId): the latest customer reply, using the same rule
 * as Find Ticket's latest_customer_comment, falling back to the latest comment of any author.
 */
export const getWorkflowTicketReplySummaryAction = withAuth(async (user, { tenant }, ticketId: string): Promise<WorkflowTicketReplySummary | null> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'ticket', 'read', knex)) {
    throw new Error('Permission denied: you need ticket read access to look up a ticket.');
  }
  const latest = () => orderTicketCommentsNewestFirst(
    tenantDb(knex, tenant).table('comments').where('ticket_id', ticketId)
  );
  const customerReply = await whereCustomerAuthoredComment(latest()).first('comment_id', 'created_at');
  const row = customerReply ?? await latest().first('comment_id', 'created_at');
  if (!row) return null;
  return {
    comment_id: String(row.comment_id),
    created_at: toIsoDate(row.created_at),
    is_customer_reply: Boolean(customerReply),
  };
});
