import { useTranslation } from "react-i18next";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Theme } from "../../ui/themes";
import type {
  Activity,
  ActivityGroup,
  CustomActivityGroup,
  MobileActivityType,
} from "../../api/activities";
import { isAdHocActivity } from "../../api/activities";

/** Section key for the synthetic "everything not in a saved group" bucket. */
export const UNGROUPED_KEY = "__ungrouped__";

/**
 * Bucket the (already-filtered) activity list into the user's saved custom groups for the
 * read-only "My groups" view. Groups and their items are emitted in saved order; activities
 * not in any group fall into a trailing "Ungrouped" bucket. Items whose activity isn't in
 * the current set (filtered out, or beyond the fetch) are skipped — mirroring the web,
 * which buckets against the activities currently in view. Produces the same shape as the
 * server's dimension grouping so the existing grouped renderer is reused unchanged.
 */
export function buildCustomGroups(
  activities: Activity[],
  customGroups: CustomActivityGroup[],
): ActivityGroup[] {
  const byKey = new Map<string, Activity>();
  for (const a of activities) byKey.set(`${a.type}:${a.id}`, a);
  const claimed = new Set<string>();

  const groups: ActivityGroup[] = [...customGroups]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => {
      const groupActivities: Activity[] = [];
      for (const item of [...g.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
        const key = `${item.activityType}:${item.activityId}`;
        const activity = byKey.get(key);
        if (activity && !claimed.has(key)) {
          groupActivities.push(activity);
          claimed.add(key);
        }
      }
      return { key: g.groupId, label: g.groupName, count: groupActivities.length, activities: groupActivities };
    });

  const ungrouped = activities.filter((a) => !claimed.has(`${a.type}:${a.id}`));
  if (ungrouped.length > 0) {
    groups.push({ key: UNGROUPED_KEY, label: "Ungrouped", count: ungrouped.length, activities: ungrouped });
  }
  return groups;
}

/** Left color-bar accent for an activity type. */
export function activityTypeColor(type: MobileActivityType, theme: Theme): string {
  // Canonical activity-type accents — kept in lock-step with the web main-app list
  // (packages/user-activities/src/components/constants.ts getActivityTypeColor).
  switch (type) {
    case "ticket":
      return theme.colors.primary; // purple
    case "projectTask":
      return theme.colors.cyan; // matches web --color-secondary-500
    case "schedule":
      return theme.colors.success; // green
    case "timeEntry":
      return theme.colors.orange; // #F97316
    case "workflowTask":
      return theme.colors.accent; // orange (brand accent)
    case "notification":
      return theme.colors.indigo; // #6366F1
    case "document":
    default:
      return theme.colors.textSecondary;
  }
}

/**
 * Activity-type icon, from a single MaterialCommunityIcons set — one consistent family whose
 * outline glyphs read close to the web main-app's lucide icons. Kept in lock-step with the
 * web list (ActivitiesDataTable / GroupedActivitiesView getTypeIcon): ticket, layers,
 * calendar, clock, git-branch (source-branch), bell.
 */
export function activityTypeIcon(activity: Activity): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (activity.type) {
    case "ticket":
      return "ticket-outline";
    case "projectTask":
      return "layers-outline";
    case "schedule":
      return "calendar-blank-outline";
    case "timeEntry":
      return "clock-outline";
    case "workflowTask":
      return "source-branch";
    case "notification":
      return "bell-outline";
    case "document":
    default:
      return "file-document-outline";
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
