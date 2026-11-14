import type { IContactLocation } from '@alga-psa/types';

/**
 * Where the ticket's requester works, as the contact tile reads it. Pure so the two ticket layouts
 * (grid tile and entry sidebar) agree without sharing a component, and so the "+N", "Remote" and
 * "offer the contact's site" rules are testable without rendering anything.
 */
export type RequesterLocationContact = {
  work_arrangement?: string | null;
  locations?: IContactLocation[] | null;
  primaryLocation?: Pick<IContactLocation, 'location_id' | 'location_name'> | null;
} | null | undefined;

export interface RequesterLocationLine {
  locationId: string | null;
  /** The primary site, with "+N" when the person works at more than one. */
  name: string;
}

export function requesterLocationLine(
  contact: RequesterLocationContact,
  remoteLabel: string,
): RequesterLocationLine | null {
  const locations = contact?.locations ?? [];
  const primary = locations.find((location) => location.is_primary)
    ?? (locations.length === 1 ? locations[0] : null)
    ?? (contact?.primaryLocation
      ? { location_id: contact.primaryLocation.location_id, location_name: contact.primaryLocation.location_name }
      : null);
  const name = primary?.location_name?.trim();
  if (name && primary) {
    return {
      locationId: primary.location_id,
      name: locations.length > 1 ? `${name} +${locations.length - 1}` : name,
    };
  }
  // A remote worker has nowhere to send anyone, which is itself the answer.
  return contact?.work_arrangement === 'remote' ? { locationId: null, name: remoteLabel } : null;
}

/**
 * The site to offer when the ticket sits somewhere the requester does not work — the primary link,
 * or the first one. Never applied on its own: the offer takes a click.
 */
export function contactLocationSuggestion(
  contact: RequesterLocationContact,
  ticketLocationId: string | null | undefined,
): string | null {
  const locations = contact?.locations ?? [];
  if (locations.length === 0) return null;
  if (ticketLocationId && locations.some((location) => location.location_id === ticketLocationId)) return null;
  const suggested = locations.find((location) => location.is_primary) ?? locations[0];
  return suggested?.location_id ?? null;
}
