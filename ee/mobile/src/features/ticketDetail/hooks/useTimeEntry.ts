import { useState } from "react";
import { createTimeEntry } from "../../../api/timeEntries";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import type { TicketDetailDeps } from "../types";
import { getApiErrorMessage } from "../utils";

export function useTimeEntry(
  deps: TicketDetailDeps,
  options?: { onCreated?: () => void },
) {
  const { client, session, ticketId, showToast, t } = deps;

  const [timeEntryOpen, setTimeEntryOpen] = useState(false);
  const [timeEntryDate, setTimeEntryDate] = useState(new Date());
  const [timeEntryStartTime, setTimeEntryStartTime] = useState("");
  const [timeEntryEndTime, setTimeEntryEndTime] = useState("");
  const [timeEntryNotes, setTimeEntryNotes] = useState("");
  const [timeEntryServiceId, setTimeEntryServiceId] = useState<string | null>(null);
  const [timeEntryUpdating, setTimeEntryUpdating] = useState(false);
  const [timeEntryError, setTimeEntryError] = useState<string | null>(null);

  const openTimeEntryModal = (forDate?: Date) => {
    setTimeEntryError(null);
    const baseDate = forDate ?? new Date();
    const now = new Date();
    const isToday =
      baseDate.getFullYear() === now.getFullYear() &&
      baseDate.getMonth() === now.getMonth() &&
      baseDate.getDate() === now.getDate();

    const fmt = (d: Date) => {
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    };

    if (isToday) {
      const fifteenAgo = new Date(now.getTime() - 15 * 60_000);
      setTimeEntryStartTime(fmt(fifteenAgo));
      setTimeEntryEndTime(fmt(now));
    } else {
      setTimeEntryStartTime("09:00");
      setTimeEntryEndTime("09:15");
    }

    setTimeEntryDate(baseDate);
    setTimeEntryNotes("");
    setTimeEntryServiceId(null);
    setTimeEntryOpen(true);
  };

  const submitTimeEntry = async () => {
    if (!client || !session) return;
    if (timeEntryUpdating) return;

    if (!timeEntryServiceId) {
      setTimeEntryError(t("timeEntry.errors.noService"));
      return;
    }

    const parseTime = (hhmm: string): Date | null => {
      const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const d = new Date(timeEntryDate);
      d.setHours(Number(match[1]), Number(match[2]), 0, 0);
      return d;
    };

    const start = parseTime(timeEntryStartTime);
    const end = parseTime(timeEntryEndTime);
    if (!start || !end) {
      setTimeEntryError(t("timeEntry.errors.invalidTime"));
      return;
    }
    if (end <= start) {
      setTimeEntryError(t("timeEntry.errors.endBeforeStart"));
      return;
    }

    const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);

    setTimeEntryError(null);
    setTimeEntryUpdating(true);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await createTimeEntry(client, {
        apiKey: session.accessToken,
        work_item_type: "ticket",
        work_item_id: ticketId,
        service_id: timeEntryServiceId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        notes: timeEntryNotes.trim() || undefined,
        is_billable: true,
        auditHeaders,
      });

      if (!res.ok) {
        if (res.error.kind === "permission") {
          setTimeEntryError(t("timeEntry.errors.permission"));
          return;
        }
        if (res.error.kind === "validation") {
          const msg = getApiErrorMessage(res.error.body);
          setTimeEntryError(msg ?? t("timeEntry.errors.validation"));
          return;
        }
        setTimeEntryError(t("timeEntry.errors.generic"));
        return;
      }

      setTimeEntryOpen(false);
      showToast({ message: t("timeEntry.createdMessage", { minutes: durationMin }), tone: "info" });
      options?.onCreated?.();
    } finally {
      setTimeEntryUpdating(false);
    }
  };

  return {
    timeEntryOpen,
    setTimeEntryOpen,
    timeEntryDate,
    setTimeEntryDate,
    timeEntryStartTime,
    setTimeEntryStartTime,
    timeEntryEndTime,
    setTimeEntryEndTime,
    timeEntryNotes,
    setTimeEntryNotes,
    timeEntryServiceId,
    setTimeEntryServiceId,
    timeEntryUpdating,
    timeEntryError,
    openTimeEntryModal,
    submitTimeEntry,
  };
}
