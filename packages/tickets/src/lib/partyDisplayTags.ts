import type { IDisplayTag } from '@alga-psa/types';

/** Chip tags for a ticket's requester and client, already filtered to the viewer's audience. */
export interface PartyDisplayTags {
  contact: IDisplayTag[];
  client: IDisplayTag[];
}

export const EMPTY_PARTY_DISPLAY_TAGS: PartyDisplayTags = { contact: [], client: [] };
