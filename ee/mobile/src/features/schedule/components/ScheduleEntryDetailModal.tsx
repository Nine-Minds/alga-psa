import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import type { ScheduleEntry } from "../../../api/schedule";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge } from "../../../ui/components/Badge";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { formatDateShort } from "../../../ui/formatters/dateTime";
import { entryKindOf, formatTimeRange, hasRecurrence, isEntryEditable } from "../scheduleUtils";

export function useEntryKindLabel() {
  const { t } = useTranslation("schedule");
  return (entry: ScheduleEntry): string => {
    const type = entry.work_item_type;
    if (type === "ticket") return t("kinds.ticket", { defaultValue: "Ticket" });
    if (type === "project_task") return t("kinds.projectTask", { defaultValue: "Project task" });
    if (type === "meeting") return t("kinds.meeting", { defaultValue: "Meeting" });
    if (type === "break") return t("kinds.break", { defaultValue: "Break" });
    if (type === "other") return t("kinds.other", { defaultValue: "Other" });
    if (type === "ad_hoc" || type == null) return t("kinds.adHoc", { defaultValue: "Ad-hoc" });
    return type;
  };
}

export function entryKindIcon(entry: ScheduleEntry): keyof typeof Feather.glyphMap {
  const kind = entryKindOf(entry);
  if (kind === "ticket") return "tag";
  if (kind === "project_task") return "clipboard";
  if (entry.work_item_type === "break") return "coffee";
  if (entry.work_item_type === "meeting") return "users";
  return "calendar";
}

function assignedNames(entry: ScheduleEntry): string[] {
  return (entry.assigned_users ?? [])
    .map((u) => [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || u.user_id)
    .filter(Boolean);
}

export function ScheduleEntryDetailModal({
  visible,
  entry,
  currentUserId,
  busy,
  error,
  onOpenTicket,
  onEdit,
  onDelete,
  onClose,
}: {
  visible: boolean;
  entry: ScheduleEntry | null;
  currentUserId: string | null;
  busy: boolean;
  error: string | null;
  onOpenTicket: (ticketId: string) => void;
  onEdit: (entry: ScheduleEntry) => void;
  onDelete: (entry: ScheduleEntry) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography, borderRadius } = useTheme();
  const { t } = useTranslation("schedule");
  const kindLabel = useEntryKindLabel();

  if (!entry) return null;

  const editable = isEntryEditable(entry, currentUserId);
  const recurring = hasRecurrence(entry);
  const isTicket = entry.work_item_type === "ticket" && Boolean(entry.work_item_id);
  const names = assignedNames(entry);

  const confirmDelete = () => {
    Alert.alert(
      t("detail.deleteTitle", { defaultValue: "Delete entry?" }),
      t("detail.deleteMessage", { defaultValue: "This schedule entry will be permanently removed." }),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("detail.deleteConfirm", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: () => onDelete(entry),
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.background,
          borderTopLeftRadius: borderRadius.xl,
          borderTopRightRadius: borderRadius.xl,
          paddingBottom: spacing.xxl,
          maxHeight: "80%",
        }}
      >
        <View style={{ alignItems: "center", paddingTop: spacing.md }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <Feather name={entryKindIcon(entry)} size={20} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={{ ...typography.title, color: colors.text, flex: 1, marginLeft: spacing.sm }}>
              {entry.title}
            </Text>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
            <Badge label={kindLabel(entry)} tone={entryKindOf(entry) === "ticket" ? "info" : "neutral"} />
            {recurring ? <Badge label={t("detail.recurring", { defaultValue: "Recurring" })} tone="warning" /> : null}
            {entry.is_private ? <Badge label={t("detail.private", { defaultValue: "Private" })} tone="neutral" /> : null}
          </View>

          <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
            {t("detail.whenLabel", { defaultValue: "When" })}
          </Text>
          <Text style={{ ...typography.body, color: colors.text, marginTop: spacing.xs }}>
            {formatDateShort(entry.scheduled_start)} • {formatTimeRange(entry.scheduled_start, entry.scheduled_end)}
          </Text>

          {entry.notes ? (
            <>
              <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
                {t("detail.notesLabel", { defaultValue: "Notes" })}
              </Text>
              <Text style={{ ...typography.body, color: colors.text, marginTop: spacing.xs }}>{entry.notes}</Text>
            </>
          ) : null}

          {names.length > 0 ? (
            <>
              <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
                {t("detail.assignedLabel", { defaultValue: "Assigned to" })}
              </Text>
              <Text style={{ ...typography.body, color: colors.text, marginTop: spacing.xs }}>
                {names.join(", ")}
              </Text>
            </>
          ) : null}

          {!editable ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
              {recurring
                ? t("detail.readOnlyRecurring", { defaultValue: "Recurring entries are read-only on mobile." })
                : t("detail.readOnly", { defaultValue: "This entry is read-only on mobile." })}
            </Text>
          ) : null}

          {error ? (
            <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.md }}>{error}</Text>
          ) : null}

          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            {isTicket ? (
              <PrimaryButton onPress={() => onOpenTicket(entry.work_item_id as string)} disabled={busy}>
                {t("detail.openTicket", { defaultValue: "Open ticket" })}
              </PrimaryButton>
            ) : null}
            {editable ? (
              <PrimaryButton onPress={() => onEdit(entry)} disabled={busy}>
                {t("detail.edit", { defaultValue: "Edit" })}
              </PrimaryButton>
            ) : null}
            {editable ? (
              <PrimaryButton onPress={confirmDelete} disabled={busy}>
                {busy
                  ? t("detail.deleting", { defaultValue: "Deleting…" })
                  : t("detail.delete", { defaultValue: "Delete" })}
              </PrimaryButton>
            ) : null}
            <PrimaryButton onPress={onClose} disabled={busy}>
              {t("common:close")}
            </PrimaryButton>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
