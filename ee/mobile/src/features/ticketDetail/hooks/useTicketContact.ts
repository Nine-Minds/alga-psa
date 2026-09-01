import { useState } from "react";
import { updateTicketContact, type TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache } from "../../../cache/ticketsCache";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage, ticketUpdateSuccessMessage } from "../utils";

export function useTicketContact(
  deps: TicketDetailDeps & {
    fetchTicket: () => Promise<void>;
  },
) {
  const { client, session, ticketId, t, showToast, fetchTicket } = deps;

  const [contactUpdating, setContactUpdating] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);

  const updateContact = async (
    contactNameId: string | null,
    notificationSuppression?: TicketNotificationSuppressionOptions,
  ) => {
    if (!client || !session) return false;
    if (contactUpdating) return false;
    setContactError(null);
    setContactUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await updateTicketContact(client, {
        apiKey: session.accessToken,
        ticketId,
        contact_name_id: contactNameId,
        notificationSuppression,
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setContactError(t("detail.errors.contactPermission"));
          return false;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setContactError(msg ?? t("detail.errors.contactValidation"));
          return false;
        }
        setContactError(t("detail.errors.contactGeneric"));
        return false;
      }
      invalidateTicketsListCache();
      await fetchTicket();
      showToast({
        message: ticketUpdateSuccessMessage(t, notificationSuppression, t("detail.contactUpdated", { defaultValue: "Contact updated" })),
        tone: "success",
      });
      return true;
    } finally {
      setContactUpdating(false);
    }
  };

  const selectContact = async (contactNameId: string, notificationSuppression?: TicketNotificationSuppressionOptions) => {
    const updated = await updateContact(contactNameId, notificationSuppression);
    if (updated) setContactPickerOpen(false);
  };

  const removeContact = async (notificationSuppression?: TicketNotificationSuppressionOptions) => {
    const updated = await updateContact(null, notificationSuppression);
    if (updated) setContactPickerOpen(false);
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
