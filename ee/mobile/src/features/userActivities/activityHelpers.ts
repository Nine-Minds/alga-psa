import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import type { Theme } from "../../ui/themes";
import type { Activity, MobileActivityType } from "../../api/activities";
import { isAdHocActivity } from "../../api/activities";

/** Left color-bar accent for an activity type. */
export function activityTypeColor(type: MobileActivityType, theme: Theme): string {
  switch (type) {
    case "ticket":
      return theme.colors.info;
    case "projectTask":
      return theme.colors.primary;
    case "schedule":
      return theme.colors.success;
    case "timeEntry":
      return theme.colors.warning;
    case "workflowTask":
      return theme.colors.secondary;
    case "notification":
      return theme.colors.accent;
    case "document":
    default:
      return theme.colors.textSecondary;
  }
}

export function activityTypeIcon(activity: Activity): keyof typeof Feather.glyphMap {
  switch (activity.type) {
    case "ticket":
      return "tag";
    case "projectTask":
      return "clipboard";
    case "schedule":
      return isAdHocActivity(activity) ? "check-square" : "calendar";
    case "timeEntry":
      return "clock";
    case "workflowTask":
      return "git-branch";
    case "notification":
      return "bell";
    case "document":
    default:
      return "file-text";
  }
}

/** i18n label for an activity type (uses the ad-hoc label for personal to-dos). */
export function useActivityTypeLabel(): (activity: Activity) => string {
  const { t } = useTranslation("userActivities");
  return (activity: Activity): string => {
    if (isAdHocActivity(activity)) return t("types.adHoc", { defaultValue: "Ad-hoc" });
    switch (activity.type) {
      case "ticket":
        return t("types.ticket", { defaultValue: "Ticket" });
      case "projectTask":
        return t("types.projectTask", { defaultValue: "Project task" });
      case "schedule":
        return t("types.schedule", { defaultValue: "Schedule" });
      case "timeEntry":
        return t("types.timeEntry", { defaultValue: "Time entry" });
      case "workflowTask":
        return t("types.workflowTask", { defaultValue: "Workflow task" });
      case "notification":
        return t("types.notification", { defaultValue: "Notification" });
      case "document":
      default:
        return t("types.document", { defaultValue: "Document" });
    }
  };
}

export function priorityTone(
  priority: Activity["priority"],
): "neutral" | "success" | "warning" | "danger" {
  if (priority === "high") return "danger";
  if (priority === "medium") return "warning";
  if (priority === "low") return "success";
  return "neutral";
}
