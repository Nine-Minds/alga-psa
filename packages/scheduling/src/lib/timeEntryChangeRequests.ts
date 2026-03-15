import {
  ITimeEntry,
  ITimeEntryChangeRequest,
  TimeEntryChangeRequestState,
} from '@alga-psa/types';

export function sortTimeEntryChangeRequests(
  changeRequests: ITimeEntryChangeRequest[],
): ITimeEntryChangeRequest[] {
  return [...changeRequests].sort((left, right) =>
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
}

export function getLatestTimeEntryChangeRequest(
  changeRequests?: ITimeEntryChangeRequest[],
): ITimeEntryChangeRequest | undefined {
  if (!changeRequests || changeRequests.length === 0) {
    return undefined;
  }

  return sortTimeEntryChangeRequests(changeRequests)[0];
}

export function getProminentTimeEntryChangeRequest(
  changeRequests?: ITimeEntryChangeRequest[],
): ITimeEntryChangeRequest | undefined {
  return getLatestTimeEntryChangeRequest(changeRequests);
}

export function getTimeEntryChangeRequestState(
  changeRequests?: ITimeEntryChangeRequest[],
): TimeEntryChangeRequestState | null {
  if (!changeRequests || changeRequests.length === 0) {
    return null;
  }

  return changeRequests.some((changeRequest) => !changeRequest.handled_at)
    ? 'unresolved'
    : 'handled';
}

export function groupTimeEntryChangeRequestsByEntryId(
  changeRequests: ITimeEntryChangeRequest[],
): Map<string, ITimeEntryChangeRequest[]> {
  const byEntryId = new Map<string, ITimeEntryChangeRequest[]>();

  for (const changeRequest of changeRequests) {
    const existing = byEntryId.get(changeRequest.time_entry_id) ?? [];
    existing.push(changeRequest);
    byEntryId.set(changeRequest.time_entry_id, existing);
  }

  for (const [entryId, entryRequests] of byEntryId.entries()) {
    byEntryId.set(entryId, sortTimeEntryChangeRequests(entryRequests));
  }

  return byEntryId;
}

export function attachTimeEntryChangeRequests<T extends ITimeEntry>(
  entries: T[],
  changeRequestsByEntryId: Map<string, ITimeEntryChangeRequest[]>,
): T[] {
  return entries.map((entry) => {
    const entryId = entry.entry_id ?? undefined;
    const changeRequests = entryId ? changeRequestsByEntryId.get(entryId) ?? [] : [];
    const latestChangeRequest = getLatestTimeEntryChangeRequest(changeRequests);

    return {
      ...entry,
      change_requests: changeRequests,
      latest_change_request: latestChangeRequest,
      change_request_state: getTimeEntryChangeRequestState(changeRequests),
    };
  });
}
