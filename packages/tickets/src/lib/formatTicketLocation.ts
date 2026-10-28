/**
 * One-line rendering of a client location, as the ticket surfaces show it.
 *
 * Both ticket detail layouts resolve the same location line, so the formatter
 * lives here rather than once per layout — a drifting copy would make the grid
 * and list views disagree about the same ticket.
 */
export interface TicketLocationLike {
  location_name?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
}

export const formatTicketLocationDisplay = (
  location: TicketLocationLike,
  unnamedLocationLabel: string,
): string => {
  const parts: string[] = [];

  if (location.location_name) {
    parts.push(location.location_name);
  }

  if (location.address_line1) {
    parts.push(location.address_line1);
  }

  if (location.city && location.state_province) {
    parts.push(`${location.city}, ${location.state_province}`);
  } else if (location.city) {
    parts.push(location.city);
  } else if (location.state_province) {
    parts.push(location.state_province);
  }

  if (location.postal_code) {
    parts.push(location.postal_code);
  }

  return parts.join(' - ') || unnamedLocationLabel;
};
