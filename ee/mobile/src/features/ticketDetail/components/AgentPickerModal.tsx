import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { Avatar } from "../../../ui/components/Avatar";
import { getUserDisplayName, listUsers, type UserListItem } from "../../../api/users";
import type { ApiClient } from "../../../api/client";

export function AgentPickerModal({
  visible,
  updating,
  updateError,
  currentAssignedToName,
  onSelect,
  onUnassign,
  onClose,
  client,
  apiKey,
  baseUrl,
}: {
  visible: boolean;
  updating: boolean;
  updateError: string | null;
  currentAssignedToName: string | null | undefined;
  onSelect: (userId: string, displayName: string) => void;
  onUnassign: () => void;
  onClose: () => void;
  client: ApiClient | null;
  apiKey: string;
  baseUrl: string | null;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchUsers = useCallback(async (query: string) => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await listUsers(client, {
        apiKey,
        search: query || undefined,
        limit: 50,
        signal: controller.signal,
      });
      if (!res.ok) {
        setError(t("agentPicker.unableToLoad"));
        return;
      }
      setUsers(res.data.data);
    } catch {
      if (!controller.signal.aborted) {
        setError(t("agentPicker.unableToLoad"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [client, apiKey, t]);

  useEffect(() => {
    if (visible) {
      setSearch("");
      void fetchUsers("");
    } else {
      abortRef.current?.abort();
      setUsers([]);
      setError(null);
    }
  }, [visible, fetchUsers]);

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void fetchUsers(text.trim());
    }, 350);
  };

  const busy = updating;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl, maxHeight: "70%" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm }}>
          <Text style={{ ...typography.title, color: colors.text }}>{t("agentPicker.title")}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} hitSlop={12}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>{t("common:close")}</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <TextInput
            placeholder={t("agentPicker.searchPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={handleSearchChange}
            autoCorrect={false}
            autoCapitalize="none"
            style={{
              ...typography.body,
              color: colors.text,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.card,
            }}
          />
        </View>

        {currentAssignedToName ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agentPicker.unassign")}
            disabled={busy}
            onPress={onUnassign}
            style={({ pressed }) => ({
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              marginHorizontal: spacing.lg,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              opacity: busy ? 0.65 : pressed ? 0.95 : 1,
              marginBottom: spacing.sm,
            })}
          >
            <Text style={{ ...typography.body, color: colors.danger }}>
              {t("agentPicker.unassign")}
            </Text>
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
              {t("agentPicker.currentlyAssigned", { name: currentAssignedToName })}
            </Text>
          </Pressable>
        ) : null}

        {updateError ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger, marginBottom: spacing.sm }}>
            {updateError}
          </Text>
        ) : null}

        {loading && users.length === 0 ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {t("common:loading")}
            </Text>
          </View>
        ) : error ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger }}>
            {error}
          </Text>
        ) : (
          <ScrollView style={{ paddingHorizontal: spacing.lg }} keyboardShouldPersistTaps="handled">
            {users.length === 0 && !loading ? (
              <Text style={{ ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm }}>
                {t("agentPicker.noResults")}
              </Text>
            ) : null}
            {users.map((user) => {
              const displayName = getUserDisplayName(user);
              const avatarUri = user.avatarUrl && baseUrl ? `${baseUrl}${user.avatarUrl}` : undefined;
              return (
                <Pressable
                  key={user.user_id}
                  accessibilityRole="button"
                  accessibilityLabel={t("agentPicker.assignTo", { name: displayName })}
                  disabled={busy}
                  onPress={() => onSelect(user.user_id, displayName)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    opacity: busy ? 0.65 : pressed ? 0.95 : 1,
                    marginBottom: spacing.sm,
                  })}
                >
                  <Avatar name={displayName} imageUri={avatarUri} size="sm" />
                  <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                    <Text style={{ ...typography.body, color: colors.text }}>{displayName}</Text>
                    <Text style={{ ...typography.caption, color: colors.textSecondary }}>{user.email}</Text>
                  </View>
                  {busy ? <ActivityIndicator size="small" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
