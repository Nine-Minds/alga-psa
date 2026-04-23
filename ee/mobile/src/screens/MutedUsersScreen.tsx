import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { useAuth } from "../auth/AuthContext";
import { useModeration } from "../features/moderation/useModeration";
import { createApiClient } from "../api";
import { getUserDisplayName, listUsers, type UserListItem } from "../api/users";
import { getAppConfig } from "../config/appConfig";
import { logger } from "../logging/logger";

/**
 * Screen for reviewing and unmuting users that the signed-in user has muted
 * via the comment overflow menu. Required so mute is reversible (guideline 1.2).
 */
export function MutedUsersScreen() {
  const { t } = useTranslation("settings");
  const theme = useTheme();
  const { session } = useAuth();
  const moderation = useModeration();

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [unmuting, setUnmuting] = useState<string | null>(null);

  const client = useMemo(() => {
    const config = getAppConfig();
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getAccessToken: () => session.accessToken,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => `mobile/${Platform.OS}/muted-users`,
    });
  }, [session]);

  // Hydrate display names for muted user IDs.
  useEffect(() => {
    const mutedIds = Array.from(moderation.mutedUserIds);
    if (mutedIds.length === 0 || !client || !session) {
      setUsers([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const result = await listUsers(client, {
          apiKey: session.accessToken,
          limit: 200,
          signal: controller.signal,
        });
        if (!result.ok) {
          if (!controller.signal.aborted) setUsers([]);
          return;
        }
        const mutedSet = new Set(mutedIds);
        setUsers(result.data.data.filter((u) => mutedSet.has(u.user_id)));
      } catch (e) {
        if (!controller.signal.aborted) logger.warn("Failed to load muted users", { error: e });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [moderation.mutedUserIds, client, session]);

  const confirmUnmute = useCallback(
    (user: UserListItem) => {
      const displayName = getUserDisplayName(user);
      Alert.alert(
        t("mutedUsers.unmuteTitle", "Unmute {{name}}?", { name: displayName }),
        t("mutedUsers.unmuteBody", "Their comments will be visible in the mobile app again."),
        [
          { text: t("common:cancel"), style: "cancel" },
          {
            text: t("mutedUsers.unmuteConfirm", "Unmute"),
            onPress: () => {
              setUnmuting(user.user_id);
              void moderation.unmute(user.user_id).finally(() => setUnmuting(null));
            },
          },
        ],
      );
    },
    [moderation, t],
  );

  const hasMuted = moderation.mutedUserIds.size > 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg }}
    >
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
        {t("mutedUsers.title", "Muted users")}
      </Text>
      <Text
        style={{
          ...theme.typography.body,
          color: theme.colors.textSecondary,
          marginTop: theme.spacing.sm,
        }}
      >
        {t(
          "mutedUsers.body",
          "People you've muted won't appear in your comment view on mobile. Tap to unmute.",
        )}
      </Text>

      {!hasMuted ? (
        <Text
          style={{
            ...theme.typography.body,
            color: theme.colors.textSecondary,
            marginTop: theme.spacing.lg,
            textAlign: "center",
          }}
        >
          {t("mutedUsers.empty", "You haven't muted anyone.")}
        </Text>
      ) : loading ? (
        <View style={{ alignItems: "center", marginTop: theme.spacing.lg }}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={{ marginTop: theme.spacing.lg }}>
          {users.length === 0 ? (
            <Text
              style={{
                ...theme.typography.body,
                color: theme.colors.textSecondary,
              }}
            >
              {t(
                "mutedUsers.nameLookupFailed",
                "Couldn't look up names for the users you've muted. You can still unmute by visiting this screen again when you have a connection.",
              )}
            </Text>
          ) : (
            users.map((u) => (
              <Pressable
                key={u.user_id}
                onPress={() => confirmUnmute(u)}
                accessibilityRole="button"
                accessibilityLabel={t("mutedUsers.unmuteAccessibility", {
                  defaultValue: "Unmute {{name}}",
                  name: getUserDisplayName(u),
                })}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: theme.spacing.md,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View>
                  <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                    {getUserDisplayName(u)}
                  </Text>
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                    {u.email}
                  </Text>
                </View>
                {unmuting === u.user_id ? (
                  <ActivityIndicator />
                ) : (
                  <Feather name="volume-2" size={18} color={theme.colors.primary} />
                )}
              </Pressable>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}
