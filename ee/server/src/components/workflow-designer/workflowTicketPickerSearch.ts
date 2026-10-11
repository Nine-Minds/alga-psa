import { getTicketsForList } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export type WorkflowTicketPickerOption = {
  value: string;
  label: string;
  secondaryLabel?: string;
};

type WorkflowTicketLike = {
  ticket_id?: string | null;
  ticket_number?: string | null;
  title?: string | null;
  client_name?: string | null;
  board_name?: string | null;
  status_name?: string | null;
};

const KNOWN_PLACEHOLDER_NAMES = new Set(['', 'Unknown']);

const meaningfulName = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return KNOWN_PLACEHOLDER_NAMES.has(trimmed) ? null : trimmed;
};

export const formatWorkflowTicketLabel = (ticket: WorkflowTicketLike, fallbackId: string): string => {
  const number = ticket.ticket_number?.trim();
  const title = ticket.title?.trim();
  if (number && title) return `${number} · ${title}`;
  return number || title || fallbackId;
};

export const toWorkflowTicketPickerOption = (ticket: WorkflowTicketLike): WorkflowTicketPickerOption | null => {
  if (!ticket.ticket_id) return null;
  const details = [ticket.client_name, ticket.board_name, ticket.status_name]
    .map(meaningfulName)
    .filter((part): part is string => Boolean(part));
  return {
    value: ticket.ticket_id,
    label: formatWorkflowTicketLabel(ticket, ticket.ticket_id),
    ...(details.length > 0 ? { secondaryLabel: details.join(' · ') } : {}),
  };
};

/**
 * Bounded, permission-aware ticket search for workflow pickers.
 *
 * Uses the paginated ticket list action (SQL-side authorization, indexed search that
 * also matches ticket numbers by substring, so "1122" finds "TIC001122"). Includes
 * tickets on every board and in every status: a workflow input or test run may target
 * a closed ticket or one on an inactive board.
 */
export const searchWorkflowTickets = async ({
  search,
  page,
  limit,
}: {
  search: string;
  page: number;
  limit: number;
}): Promise<{ options: WorkflowTicketPickerOption[]; total: number }> => {
  const result = await getTicketsForList(
    {
      boardFilterState: 'all',
      searchQuery: search.trim() || undefined,
      sortBy: 'entered_at',
      sortDirection: 'desc',
    },
    page,
    limit
  );

  if (isActionPermissionError(result) || isActionMessageError(result)) {
    throw new Error(getErrorMessage(result));
  }
  if (!result || !Array.isArray(result.tickets)) {
    throw new Error('Ticket search returned an unexpected response.');
  }

  return {
    options: result.tickets
      .map((ticket) => toWorkflowTicketPickerOption(ticket))
      .filter((option): option is WorkflowTicketPickerOption => option !== null),
    total: result.totalCount,
  };
};
