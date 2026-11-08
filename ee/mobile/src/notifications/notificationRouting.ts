/**
 * Where a tapped notification lands. Kept out of useNotifications so the
 * routing table can be tested without the hook's permission and registration
 * machinery.
 */

import * as Linking from "expo-linking";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { SCHEDULE_REMINDER_KIND } from "./scheduleReminders";
import { resolveReminderTarget } from "./reminderTarget";

export type NotificationData = {
  ticketId?: string;
  taskId?: string;
  projectId?: string;
  assetId?: string;
  kind?: string;
  url?: string;
  priority?: string;
  workItemType?: string | null;
  workItemId?: string | null;
};

export async function navigateFromNotification(
  data: NotificationData | undefined,
  navigation: NativeStackNavigationProp<RootStackParamList>,
  lookupInteractionTicket: (interactionId: string) => Promise<string | null>,
): Promise<void> {
  if (data?.ticketId) {
    navigation.navigate("TicketDetail", { ticketId: data.ticketId });
    return;
  }
  if (data?.taskId) {
    navigation.navigate("ProjectTaskDetail", { taskId: data.taskId });
    return;
  }
  // A payload with only a projectId is about the project, not one of its tasks.
  if (data?.projectId) {
    navigation.navigate("ProjectDetail", { projectId: data.projectId });
    return;
  }
  if (data?.assetId) {
    navigation.navigate("AssetDetail", { assetId: data.assetId });
    return;
  }
  if (data?.kind === SCHEDULE_REMINDER_KIND) {
    // A follow-up booked from a ticket lands back on that ticket; other
    // entries route through the deep-link layer so the drawer tab resolves
    // the same way as an external alga://schedule link.
    const target = await resolveReminderTarget(data, lookupInteractionTicket);
    if (target.kind === "ticket") {
      navigation.navigate("TicketDetail", { ticketId: target.ticketId });
      return;
    }
    void Linking.openURL("alga://schedule");
  }
}

/** Test seam; the hook calls navigateFromNotification directly. */
export const navigateFromNotificationForTest = navigateFromNotification;
