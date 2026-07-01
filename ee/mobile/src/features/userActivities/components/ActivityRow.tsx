import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge } from "../../../ui/components/Badge";
import { formatDateShort } from "../../../ui/formatters/dateTime";
import { formatTimeRange } from "../../schedule/scheduleUtils";
import type { Activity } from "../../../api/activities";
import { isAdHocActivity } from "../../../api/activities";
import { activityTypeColor, activityTypeIcon, priorityTone, useActivityTypeLabel } from "../activityHelpers";

function humanizeStatus(status: string): string {
  if (!status) return "";
  return status
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function useSubtitle(): (activity: Activity) => string | null {
  const { t } = useTranslation("userActivities");
  return (activity: Activity): string | null => {
    switch (activity.type) {
      case "ticket": {
        const parts = [activity.ticketNumber, activity.clientName].filter(Boolean);
        return parts.length > 0 ? parts.join(" • ") : null;
      }
      case "projectTask": {
        const parts = [activity.projectName, activity.phaseName].filter(Boolean);
        return parts.length > 0 ? parts.join(" • ") : null;
      }
      case "schedule": {
        if (isAdHocActivity(activity)) {
          if (activity.startDate && activity.endDate) {
            return `${formatDateShort(activity.startDate)} • ${formatTimeRange(activity.startDate, activity.endDate)}`;
          }
          if (activity.startDate) return formatDateShort(activity.startDate);
          return t("row.noDate", { defaultValue: "No date" });
        }
        if (activity.startDate && activity.endDate) {
          return `${formatDateShort(activity.startDate)} • ${formatTimeRange(activity.startDate, activity.endDate)}`;
        }
        return activity.startDate ? formatDateShort(activity.startDate) : null;
      }
      case "timeEntry":
        return activity.workItemType ? humanizeStatus(activity.workItemType) : null;
      case "workflowTask":
        return activity.dueDate ? t("row.due", { date: formatDateShort(activity.dueDate), defaultValue: "Due {{date}}" }) : null;
      case "notification":
        return activity.message ?? null;
      case "document":
        return activity.documentName ?? null;
      default:
        return null;
    }
  };
}

export const ActivityRow = memo(function ActivityRow({
  activity,
  onPress,
}: {
  activity: Activity;
  onPress: (activity: Activity) => void;
}) {
  const { t } = useTranslation("userActivities");
  const theme = useTheme();
  const typeLabel = useActivityTypeLabel();
  const subtitleFor = useSubtitle();

  const handlePress = useCallback(() => onPress(activity), [activity, onPress]);

  const barColor = activityTypeColor(activity.type, theme);
  const subtitle = useMemo(() => subtitleFor(activity), [activity, subtitleFor]);
  const closed = activity.isClosed === true;
  const statusLabel = humanizeStatus(activity.status) || t("common:unknown");
  const priorityLabel = activity.priorityName ?? activity.priority;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("row.accessibility", {
        type: typeLabel(activity),
        title: activity.title,
        defaultValue: "{{type}}: {{title}}",
      })}
      style={({ pressed }) => ({
        flexDirection: "row",
        marginBottom: theme.spacing.sm,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden",
        opacity: pressed ? 0.96 : 1,
      })}
    >
      <View style={{ width: 4, backgroundColor: barColor }} />
      <View style={{ flex: 1, padding: theme.spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <MaterialCommunityIcons name={activityTypeIcon(activity)} size={14} color={barColor} />
          <Text
            style={{
              ...theme.typography.caption,
              color: theme.colors.textSecondary,
              marginLeft: theme.spacing.xs,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {typeLabel(activity)}
            {subtitle ? ` • ${subtitle}` : ""}
          </Text>
        </View>

        <Text
          style={{
            ...theme.typography.body,
            color: theme.colors.text,
            marginTop: 2,
            textDecorationLine: closed ? "line-through" : "none",
          }}
          numberOfLines={2}
        >
          {activity.title}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
          <Badge label={statusLabel} tone={closed ? "neutral" : "info"} />
          {priorityLabel ? <Badge label={humanizeStatus(priorityLabel)} tone={priorityTone(activity.priority)} /> : null}
        </View>

        {activity.assignedToNames && activity.assignedToNames.length > 0 ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
            {t("row.assignedTo", {
              name: activity.assignedToNames.join(", "),
              defaultValue: "Assigned to {{name}}",
            })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});
