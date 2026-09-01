interface TicketCallPhoneContact {
  default_phone_number?: string | null;
  phone_numbers?: Array<{ phone_number?: string | null; is_default?: boolean }>;
}

/** Phone priority shared by the contact tile and Calls-and-emails action. */
export function resolveTicketCallPhone(input: {
  contact?: TicketCallPhoneContact | null;
  locationPhone?: string | null;
  clientPhone?: string | null;
}): string | null {
  return input.contact?.default_phone_number
    || input.contact?.phone_numbers?.find((phoneNumber) => phoneNumber.is_default)?.phone_number
    || input.contact?.phone_numbers?.[0]?.phone_number
    || input.locationPhone
    || input.clientPhone
    || null;
}
