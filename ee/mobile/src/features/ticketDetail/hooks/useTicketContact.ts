import { useState } from "react";
import { updateTicketContact } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage } from "../utils";

export function useTicketContact(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
  },
) {
  const { client, session, ticketId, t, fetchTicket } = deps;

  const [contactUpdating, setContactUpdating] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);

  const updateContact = async (contactNameId: string | null) => {
    if (!client || !session) return;
    if (contactUpdating) return;
    setContactError(null);
    setContactUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketContact(client, {
        apiKey: session.accessToken,
        ticketId,
        contact_name_id: contactNameId,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setContactError(t("detail.errors.contactPermission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setContactError(msg ?? t("detail.errors.contactValidation"));
          return;
        }
        setContactError(t("detail.errors.contactGeneric"));
        return;
      }
      invalidateTicketsListCache();
      await fetchTicket();
    } finally {
      setContactUpdating(false);
    }
  };

  const selectContact = async (contactNameId: string) => {
    await updateContact(contactNameId);
    setContactPickerOpen(false);
  };

  const removeContact = async () => {
    await updateContact(null);
    setContactPickerOpen(false);
  };

  const openContactPicker = () => {
    setContactError(null);
    setContactPickerOpen(true);
  };

  const closeContactPicker = () => {
    setContactPickerOpen(false);
  };

  return {
    contactUpdating,
    contactError,
    contactPickerOpen,
    selectContact,
    removeContact,
    openContactPicker,
    closeContactPicker,
  };
}
