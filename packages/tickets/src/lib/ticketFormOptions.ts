import { sanitizeUserForResponse } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';

/** The user fields required by the ticket form's assignable-agent pickers. */
export interface TicketFormUserOption {
  user_id: string;
  first_name?: string;
  last_name?: string;
  icon?: string;
  tenant?: string;
  user_type: string;
  is_inactive: boolean;
}

/** The client fields read by the ticket dashboard and its in-memory ClientPicker. */
export interface TicketFormClientOption {
  client_id: string;
  client_name: string;
  client_type?: IClient['client_type'];
  tenant?: string;
  is_inactive: boolean;
  logoUrl: string | null;
  displayTags: IClient['displayTags'];
}

export function toTicketFormUserOption(row: Record<string, unknown>): TicketFormUserOption {
  const safeUser = sanitizeUserForResponse(row);
  return {
    user_id: safeUser.user_id,
    first_name: safeUser.first_name,
    last_name: safeUser.last_name,
    icon: safeUser.icon,
    tenant: safeUser.tenant,
    user_type: safeUser.user_type,
    is_inactive: safeUser.is_inactive,
  };
}
