import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Application from "expo-application";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { phase2Features } from "../features/phase2";
import { useAuth } from "../auth/AuthContext";
import { useAppResume } from "../hooks/useAppResume";
import { useToast } from "../ui/toast/ToastProvider";
import { requestPushPermission, getExpoPushToken } from "./pushTokenService";
import { registerPushToken, unregisterPushToken } from "../api/pushToken";
import { createApiClient } from "../api";
import { getAppConfig } from "../config/appConfig";
import { getStableDeviceId } from "../device/clientMetadata";
import { getSecureJson, setSecureJson } from "../storage/secureStorage";
import { logger } from "../logging/logger";
import type { RootStackParamList } from "../navigation/types";

const STORED_TOKEN_KEY = "alga.mobile.push.registeredToken";

// Suppress OS notification when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

/**
 * Manages push notification registration, token sync, and tap handling.
 * Gated behind `phase2Features.notifications`.
 */
export function useNotifications(): void {
  if (!phase2Features.notifications) return;

  const { session, refreshSession } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showToast } = useToast();
  const registering = useRef(false);

  const registerToken = useCallback(async () => {
    if (!session?.accessToken || registering.current) return;
    registering.current = true;

    try {
      const granted = await requestPushPermission();
      if (!granted) return;

      const [token, deviceId] = await Promise.all([
        getExpoPushToken(),
        getStableDeviceId(),
      ]);

      if (!token || !deviceId) return;

      // Skip if already registered with the same token
      const stored = await getSecureJson<string>(STORED_TOKEN_KEY);
      if (stored === token) return;

      const config = getAppConfig();
      if (!config.ok) return;

      const client = createApiClient({
        baseUrl: config.baseUrl,
        getTenantId: () => session.tenantId,
        getUserAgentTag: () => "mobile/push",
        onAuthError: refreshSession,
      });

      const result = await registerPushToken(client, {
        expoPushToken: token,
        deviceId,
        platform: Platform.OS,
        appVersion: Application.nativeApplicationVersion ?? undefined,
      });

      if (result.ok) {
        await setSecureJson(STORED_TOKEN_KEY, token);
        logger.info("[Notifications] Push token registered");
      } else {
        logger.warn("[Notifications] Failed to register push token", { error: result.error });
      }
    } catch (err) {
      logger.error("[Notifications] Token registration error", { err });
    } finally {
      registering.current = false;
    }
  }, [session?.accessToken, session?.tenantId, refreshSession]);

  // Register after login
  useEffect(() => {
    void registerToken();
  }, [registerToken]);

  // Re-register on app resume (token may have rotated)
  useAppResume(() => {
    void registerToken();
  });

  // Show in-app toast when notification arrives while app is foregrounded
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body } = notification.request.content;
      const data = notification.request.content.data as
        | { ticketId?: string }
        | undefined;

      showToast({
        message: title || body || "New notification",
        tone: "info",
        durationMs: 4000,
      });

      // Navigate to ticket if data is present
      if (data?.ticketId) {
        navigation.navigate("TicketDetail", { ticketId: data.ticketId });
      }
    });
    return () => sub.remove();
  }, [navigation, showToast]);

  // Handle notification tap → navigate to ticket
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { ticketId?: string }
        | undefined;
      if (data?.ticketId) {
        navigation.navigate("TicketDetail", { ticketId: data.ticketId });
      }
    });
    return () => sub.remove();
  }, [navigation]);

  // Handle cold launch from notification
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as
        | { ticketId?: string }
        | undefined;
      if (data?.ticketId) {
        navigation.navigate("TicketDetail", { ticketId: data.ticketId });
      }
    });
  }, [navigation]);
}
