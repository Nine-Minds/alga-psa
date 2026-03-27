import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';

export const TICKET_STATUS_FILTER_OPEN = '__status_filter__:open';
export const TICKET_STATUS_FILTER_ALL = '__status_filter__:all';
export const TICKET_STATUS_FILTER_CLOSED = '__status_filter__:closed';
const TICKET_STATUS_NAME_PREFIX = '__status_name__:';

export interface TicketStatusFilterOption extends SelectOption {
  statusName?: string;
  boardId?: string | null;
  isClosed?: boolean;
}

type ParsedTicketStatusFilter =
  | { kind: 'open' }
  | { kind: 'all' }
  | { kind: 'closed' }
  | { kind: 'name'; statusName: string }
  | { kind: 'id'; statusId: string };

export function isTicketStatusOpenFilter(statusId?: string | null): boolean {
  return statusId === TICKET_STATUS_FILTER_OPEN;
}

export function isTicketStatusClosedFilter(statusId?: string | null): boolean {
  return statusId === TICKET_STATUS_FILTER_CLOSED;
}

export function shouldApplyOpenOnlyStatusFilter(
  statusId?: string | null,
  showOpenOnly?: boolean
): boolean {
  return parseTicketStatusFilterValue(statusId).kind === 'open' || (!statusId && showOpenOnly === true);
}

export function createTicketStatusNameFilterValue(statusName: string): string {
  return `${TICKET_STATUS_NAME_PREFIX}${encodeURIComponent(statusName)}`;
}

export function parseTicketStatusFilterValue(statusId?: string | null): ParsedTicketStatusFilter {
  if (!statusId || statusId === TICKET_STATUS_FILTER_OPEN) {
    return { kind: 'open' };
  }

  if (statusId === TICKET_STATUS_FILTER_ALL) {
    return { kind: 'all' };
  }

  if (statusId === TICKET_STATUS_FILTER_CLOSED) {
    return { kind: 'closed' };
  }

  if (statusId.startsWith(TICKET_STATUS_NAME_PREFIX)) {
    return {
      kind: 'name',
      statusName: decodeURIComponent(statusId.slice(TICKET_STATUS_NAME_PREFIX.length)),
    };
  }

  return { kind: 'id', statusId };
}

export function buildTicketStatusFilterOptions(
  statusOptions: TicketStatusFilterOption[],
  selectedBoardId?: string | null,
  selectedStatusId?: string | null
): TicketStatusFilterOption[] {
  const groupedStatuses = new Map<string, TicketStatusFilterOption>();

  for (const option of statusOptions) {
    if (
      option.value === TICKET_STATUS_FILTER_OPEN ||
      option.value === TICKET_STATUS_FILTER_ALL ||
      option.value === TICKET_STATUS_FILTER_CLOSED
    ) {
      continue;
    }

    if (selectedBoardId && option.boardId !== selectedBoardId) {
      continue;
    }

    const statusName =
      option.statusName ||
      (typeof option.label === 'string' ? option.label : option.textValue);

    if (!statusName || groupedStatuses.has(statusName)) {
      continue;
    }

    groupedStatuses.set(statusName, {
      value: createTicketStatusNameFilterValue(statusName),
      label: statusName,
      textValue: statusName,
      className: option.isClosed ? 'bg-gray-200 text-gray-600' : undefined,
      statusName,
      boardId: selectedBoardId ?? option.boardId,
      isClosed: option.isClosed,
    });
  }

  return [
    { value: TICKET_STATUS_FILTER_OPEN, label: 'All open statuses' },
    { value: TICKET_STATUS_FILTER_ALL, label: 'All Statuses' },
    ...Array.from(groupedStatuses.values()),
  ];
}
