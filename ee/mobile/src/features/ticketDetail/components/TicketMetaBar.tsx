import React from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { formatDateShort } from "../../../ui/formatters/dateTime";

function MetaChip({
  label,
  tone,
  icon,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  icon?: React.ComponentProps<typeof Feather>["name"];
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const palette = theme.colors.badge[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.borderRadius.md,
        backgroundColor: palette.bg,
        borderWidth: 1,
        borderColor: palette.border,
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {icon ? <Feather name={icon} size={12} color={palette.text} /> : null}
      <Text style={{ ...theme.typography.caption, color: palette.text, fontWeight: "600" }}>{label}</Text>
      <Feather name="chevron-down" size={12} color={palette.text} />
    </Pressable>
  );
}

export function TicketMetaBar({
  statusLabel,
  statusIsClosed,
  priorityName,
  assignedToName,
  dueDateIso,
  assigneeDisabled,
  onStatusPress,
  onPriorityPress,
  onAssigneePress,
  onDuePress,
}: {
  statusLabel: string;
  statusIsClosed: boolean;
  priorityName: string | null;
  assignedToName: string | null;
  dueDateIso: string | null;
  assigneeDisabled?: boolean;
  onStatusPress: () => void;
  onPriorityPress: () => void;
  onAssigneePress: () => void;
  onDuePress: () => void;
}) {
  const { t } = useTranslation("tickets");
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      <MetaChip
        label={statusLabel}
        tone={statusIsClosed ? "neutral" : "info"}
        accessibilityLabel={t("detail.changeStatus")}
        onPress={onStatusPress}
      />
      <MetaChip
        label={priorityName ?? t("detail.priority", "Priority")}
        tone={priorityName ? "warning" : "neutral"}
        accessibilityLabel={t("detail.changePriority")}
        onPress={onPriorityPress}
      />
      <MetaChip
        icon="user"
        label={assignedToName ?? t("detail.unassigned")}
        tone="neutral"
        accessibilityLabel={t("detail.reassign")}
        onPress={onAssigneePress}
        disabled={assigneeDisabled}
      />
      <MetaChip
        icon="calendar"
        label={dueDateIso ? t("detail.dueOn", { date: formatDateShort(dueDateIso), defaultValue: "Due {{date}}" }) : t("detail.dueDate")}
        tone="neutral"
        accessibilityLabel={t("detail.dueDate")}
        onPress={onDuePress}
      />
    </View>
  );
}
