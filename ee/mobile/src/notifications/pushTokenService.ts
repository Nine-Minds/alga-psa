import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { logger } from "../logging/logger";

export async function requestPushPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function getExpoPushToken(): Promise<string | null> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      logger.warn("[PushToken] No EAS project ID found in app config");
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (err) {
    logger.error("[PushToken] Failed to get Expo push token", { err });
    return null;
  }
}
