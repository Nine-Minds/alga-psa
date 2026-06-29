import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Badge } from "../ui/components/Badge";
import { formatDateShort } from "../ui/formatters/dateTime";
import { priorityTone } from "../features/userActivities/activityHelpers";

type Props = NativeStackScreenProps<RootStackParamList, "ProjectTaskDetail">;

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProjectTaskDetailScreen({ route }: Props) {
  const { t } = useTranslation("userActivities");
  const { colors, spacing, typography } = useTheme();
  const { activity } = route.params;

  const projectLine = [activity.projectName, activity.phaseName].filter(Boolean).join(" • ");
  const assignees = activity.assignedToNames ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}>
      <Text style={{ ...typography.title, color: colors.text }}>{activity.title}</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
        <Badge label={humanize(activity.status) || t("common:unknown")} tone={activity.isClosed ? "neutral" : "info"} />
        <Badge label={humanize(activity.priorityName ?? activity.priority)} tone={priorityTone(activity.priority)} />
      </View>

      {projectLine ? (
        <Section label={t("projectTask.projectLabel", { defaultValue: "Project / phase" })} value={projectLine} colors={colors} spacing={spacing} typography={typography} />
      ) : null}

      <Section
        label={t("projectTask.statusLabel", { defaultValue: "Status" })}
        value={humanize(activity.status) || t("common:unknown")}
        colors={colors}
        spacing={spacing}
        typography={typography}
      />

      {activity.dueDate ? (
        <Section
          label={t("projectTask.dueDateLabel", { defaultValue: "Due date" })}
          value={formatDateShort(activity.dueDate)}
          colors={colors}
          spacing={spacing}
          typography={typography}
        />
      ) : null}

      {assignees.length > 0 ? (
        <Section
          label={t("projectTask.assignedLabel", { defaultValue: "Assigned to" })}
          value={assignees.join(", ")}
          colors={colors}
          spacing={spacing}
          typography={typography}
        />
      ) : null}

      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>
        {t("projectTask.descriptionLabel", { defaultValue: "Description" })}
      </Text>
      <Text style={{ ...typography.body, color: activity.description ? colors.text : colors.textSecondary, marginTop: spacing.xs }}>
        {activity.description ?? t("projectTask.noDescription", { defaultValue: "No description." })}
      </Text>

      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xl }}>
        {t("projectTask.readOnly", { defaultValue: "Project tasks are read-only on mobile." })}
      </Text>
    </ScrollView>
  );
}

function Section({
  label,
  value,
  colors,
  spacing,
  typography,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  typography: ReturnType<typeof useTheme>["typography"];
}) {
  return (
    <>
      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: spacing.xs }}>{value}</Text>
    </>
  );
}
