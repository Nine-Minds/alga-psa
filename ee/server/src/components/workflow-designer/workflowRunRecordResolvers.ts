import { getTicketById } from '@alga-psa/tickets/actions/ticketActions';

import { loadWorkflowContracts } from './WorkflowActionInputFixedPicker';
import type { WorkflowRecordSources } from './workflowRunRecordFill';
import {
  getWorkflowClientSummaryAction,
  getWorkflowTicketReplySummaryAction,
  listWorkflowAssetOptionsAction,
} from './workflowPickerServerActions';

/**
 * Records the Run dialog can "fill from" once picked, keyed by picker kind. Each resolves the
 * record's fields under canonical snake_case names and lists them up front, so the dialog can say
 * which fields a pick fills; see workflowRunRecordFill.ts.
 */
export const WORKFLOW_RUN_RECORD_SOURCES: WorkflowRecordSources = {
  contract: {
    // end_date is the client's assignment end (client_contracts.end_date), the date the Contract end
    // trigger fires on. Many contracts are open-ended and have none.
    fields: [
      'contract_name', 'client_contract_id', 'client_id', 'client_name', 'start_date', 'end_date',
      'decision_due_date', 'renewal_mode', 'renewal_cycle_key',
    ],
    kindFields: { client: ['client_id'] },
    resolve: async (contractId) => {
      const contract = (await loadWorkflowContracts()).find((entry) => entry.contract_id === contractId);
      if (!contract) return null;
      return {
        contract_name: contract.contract_name,
        client_contract_id: contract.client_contract_id,
        client_id: contract.client_id,
        client_name: contract.client_name,
        start_date: contract.start_date,
        end_date: contract.end_date,
        decision_due_date: contract.decision_due_date,
        renewal_mode: contract.renewal_mode,
        renewal_cycle_key: contract.renewal_cycle_key,
      };
    },
  },
  asset: {
    fields: ['asset_name', 'asset_tag', 'client_id', 'client_name', 'warranty_end_date'],
    kindFields: { client: ['client_id'] },
    resolve: async (assetId) => {
      const asset = (await listWorkflowAssetOptionsAction()).find((entry) => entry.asset_id === assetId);
      if (!asset) return null;
      return {
        asset_name: asset.asset_name,
        asset_tag: asset.asset_tag,
        client_id: asset.client_id,
        client_name: asset.client_name,
        warranty_end_date: asset.warranty_end_date,
      };
    },
  },
  ticket: {
    fields: [
      'ticket_number', 'title', 'client_id', 'client_name', 'contact_id', 'contact_name_id', 'contact_name',
      'board_id', 'board_name', 'status_id', 'status_name', 'priority_id', 'category_id', 'subcategory_id',
      'assigned_to', 'assigned_to_name', 'assigned_team_id', 'assignee_type', 'new_assignee_type',
      'due_date', 'entered_at', 'created_at', 'is_closed',
      // When the ticket entered its current status (ticket.status_age run payloads).
      'status_changed_at', 'entered_status_at',
      // Message events carry the comment id: the ticket's latest customer reply.
      'message_id', 'comment_id', 'received_at',
    ],
    kindFields: {
      client: ['client_id'],
      contact: ['contact_id'],
      board: ['board_id'],
      'ticket-status': ['status_id'],
      'ticket-priority': ['priority_id'],
      'ticket-category': ['category_id'],
      'ticket-subcategory': ['subcategory_id'],
      user: ['assigned_to'],
      'user-or-team': ['assigned_to', 'assigned_team_id'],
    },
    resolve: async (ticketId) => {
      const [ticket, reply] = await Promise.all([
        getTicketById(ticketId),
        getWorkflowTicketReplySummaryAction(ticketId).catch(() => null),
      ]);
      if (!ticket) return null;
      const assigneeType = ticket.assigned_to ? 'user' : ticket.assigned_team_id ? 'team' : null;
      return {
        ticket_number: ticket.ticket_number,
        title: ticket.title,
        client_id: ticket.client_id,
        client_name: ticket.client_name,
        contact_id: ticket.contact_name_id,
        contact_name_id: ticket.contact_name_id,
        contact_name: ticket.contact_name,
        board_id: ticket.board_id,
        board_name: ticket.board_name,
        status_id: ticket.status_id,
        status_name: ticket.status_name,
        priority_id: ticket.priority_id,
        category_id: ticket.category_id,
        subcategory_id: ticket.subcategory_id,
        assigned_to: ticket.assigned_to,
        assigned_to_name: ticket.assigned_to_name,
        assigned_team_id: ticket.assigned_team_id,
        // The ticket's current assignee is what an assignment event reports as the new one.
        assignee_type: assigneeType,
        new_assignee_type: assigneeType,
        due_date: ticket.due_date,
        entered_at: ticket.entered_at,
        created_at: ticket.entered_at,
        status_changed_at: ticket.status_changed_at ?? ticket.entered_at,
        entered_status_at: ticket.status_changed_at ?? ticket.entered_at,
        is_closed: ticket.is_closed,
        message_id: reply?.comment_id ?? null,
        comment_id: reply?.comment_id ?? null,
        received_at: reply?.created_at ?? null,
      };
    },
  },
  client: {
    fields: ['client_name', 'client_since', 'created_at'],
    resolve: (clientId) => getWorkflowClientSummaryAction(clientId),
  },
};
