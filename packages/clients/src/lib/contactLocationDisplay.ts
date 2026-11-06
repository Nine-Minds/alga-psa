import type { IContact, IContactLocation } from '@alga-psa/types';

/**
 * How a contact's locations read in one table cell or one picker row. Pure so both contact tables,
 * the pickers and the portal line agree without sharing a component, and so the "+N" and "Remote"
 * rules are testable without rendering anything.
 *
 * Nothing is invented: a remote worker with no links reads "Remote" (the answer to "where do I send
 * someone"), and a contact with neither reads as empty rather than as the client's head office.
 */
export interface ContactLocationCell {
  /** Primary location name, or null when there is no link to name. */
  label: string | null;
  /** How many further links there are beyond the primary. */
  extraCount: number;
  /**
   * The person works remotely. With no `label` this is the whole answer to "where do I send
   * someone", and the caller renders its own translated "Remote" — this module never returns
   * display English.
   */
  isRemote: boolean;
}

type ContactLike = Pick<IContact, 'work_arrangement'> & {
  locations?: IContactLocation[] | null;
  primaryLocation?: Pick<IContactLocation, 'location_id' | 'location_name'> | null;
};

export function contactLocationCell(contact: ContactLike): ContactLocationCell {
  const locations = contact.locations ?? [];
  const isRemote = contact.work_arrangement === 'remote';
  const primary = locations.find((location) => location.is_primary)
    ?? (locations.length === 1 ? locations[0] : null)
    ?? (contact.primaryLocation
      ? { location_id: contact.primaryLocation.location_id, location_name: contact.primaryLocation.location_name }
      : null);

  if (!primary) {
    return { label: null, extraCount: 0, isRemote };
  }

  return {
    label: primary.location_name?.trim() || null,
    extraCount: Math.max(locations.length - 1, 0),
    isRemote,
  };
}

/**
 * The sort key for the Location column: primary name, then 'Remote', with the contacts that have
 * neither last in ascending order (an empty cell is not a place, so it does not sort among them).
 */
export function contactLocationSortKey(contact: ContactLike): string {
  const cell = contactLocationCell(contact);
  return cell.label ? `0${cell.label}` : cell.isRemote ? '1' : '2';
}
