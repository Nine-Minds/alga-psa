import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketDetail } from "../../../api/tickets";
import { updateTicketAttributes } from "../../../api/tickets";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { invalidateTicketsListCache, setCachedTicketDetail } from "../../../cache/ticketsCache";
import {
  extractPlainTextFromRichEditorJson,
  extractPlainTextFromSerializedRichEditorContent,
  serializeRichEditorJson,
} from "../../ticketRichText/helpers";
import type { TicketRichTextEditorRef } from "../../ticketRichText/TicketRichTextEditor";
import type { TicketDetailDeps } from "../types";
import { extractDescription, getApiErrorMessage, getTicketAttributes } from "../utils";

export function useDescriptionEditor(
  deps: TicketDetailDeps & {
    ticket: TicketDetail | null;
    setTicket: React.Dispatch<React.SetStateAction<TicketDetail | null>>;
  },
) {
  const { client, session, ticketId, showToast, t, ticket, setTicket } = deps;

  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionPlainText, setDescriptionPlainText] = useState("");
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  const descriptionEditorRef = useRef<TicketRichTextEditorRef>(null);

  // Sync draft with ticket data when not editing
  useEffect(() => {
    if (descriptionEditing || !ticket) {
      return;
    }
    const currentDescription = extractDescription(ticket) ?? "";
    setDescriptionDraft(currentDescription);
    setDescriptionPlainText(extractPlainTextFromSerializedRichEditorContent(currentDescription));
  }, [descriptionEditing, ticket]);

  const persistDescriptionContent = useCallback(
    async (serializedDescription: string, nextPlainText: string): Promise<boolean> => {
      if (!client || !session || !ticket || descriptionSaving) {
        return false;
      }

      setDescriptionSaving(true);
      setDescriptionError(null);

      try {
        const nextAttributes = getTicketAttributes(ticket);

        if (nextPlainText) {
          nextAttributes.description = serializedDescription;
        } else {
          delete nextAttributes.description;
        }

        const auditHeaders = await getClientMetadataHeaders();
        const result = await updateTicketAttributes(client, {
          apiKey: session.accessToken,
          ticketId,
          attributes: Object.keys(nextAttributes).length === 0 ? null : nextAttributes,
          auditHeaders,
        });

        if (!result.ok) {
          if (result.error.kind === "permission") {
            setDescriptionError(t("description.errors.permission"));
            return false;
          }
          if (result.error.kind === "validation") {
            const msg = getApiErrorMessage(result.error.body);
            setDescriptionError(msg ?? t("description.errors.validation"));
            return false;
          }
          setDescriptionError(t("description.errors.generic"));
          return false;
        }

        setTicket(result.data.data);
        setCachedTicketDetail(ticketId, result.data.data);
        invalidateTicketsListCache();
        setDescriptionDraft(serializedDescription);
        setDescriptionPlainText(nextPlainText);
        setDescriptionEditing(false);
        showToast({ message: t("description.descriptionUpdated"), tone: "success" });
        return true;
      } finally {
        setDescriptionSaving(false);
      }
    },
    [client, descriptionSaving, session, showToast, ticket, ticketId],
  );

  const startDescriptionEditing = () => {
    if (!ticket) return;
    const currentDescription = extractDescription(ticket) ?? "";
    setDescriptionDraft(currentDescription);
    setDescriptionPlainText(extractPlainTextFromSerializedRichEditorContent(currentDescription));
    setDescriptionError(null);
    setDescriptionEditing(true);
  };

  const cancelDescriptionEditing = () => {
    if (!ticket) return;
    const currentDescription = extractDescription(ticket) ?? "";
    setDescriptionDraft(currentDescription);
    setDescriptionPlainText(extractPlainTextFromSerializedRichEditorContent(currentDescription));
    setDescriptionError(null);
    setDescriptionEditing(false);
  };

  const saveDescription = async () => {
    if (!client || !session || descriptionSaving) {
      return;
    }

    if (!descriptionEditorRef.current) {
      setDescriptionError(t("description.editorStillLoading"));
      return;
    }

    const nextJson = await descriptionEditorRef.current.getJSON().catch(() => null);
    if (!nextJson) {
      setDescriptionError(t("description.unableToReadEditor"));
      return;
    }

    const serializedDescription = serializeRichEditorJson(nextJson);
    const nextPlainText = extractPlainTextFromRichEditorJson(nextJson).trim();
    await persistDescriptionContent(serializedDescription, nextPlainText);
  };

  return {
    descriptionEditing,
    setDescriptionEditing,
    descriptionDraft,
    setDescriptionDraft,
    descriptionPlainText,
    setDescriptionPlainText,
    descriptionSaving,
    descriptionError,
    descriptionEditorRef,
    startDescriptionEditing,
    cancelDescriptionEditing,
    saveDescription,
    persistDescriptionContent,
  };
}
