import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { Avatar } from "../../../ui/components/Avatar";
import { getUserDisplayName, listUsers, type UserListItem } from "../../../api/users";
import type { ApiClient } from "../../../api/client";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "./TicketUpdateFooter";

export function AgentPickerModal({
  visible,
  updating,
  updateError,
  currentAssignedToId,
  currentAssignedToName,
  onApply,
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
  currentAssignedToId?: string | null;
  currentAssignedToName: string | null | undefined;
  onApply?: (userId: string | null, notificationSuppression: ReturnType<typeof activeTicketNotificationSuppression>) => void;
  /** Selection-only mode used by filters; it does not mutate a ticket. */
  onSelect?: (userId: string, displayName: string) => void;
  onUnassign?: () => void;
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
  const [selectedUser, setSelectedUser] = useState<{ id: string | null; name: string | null } | null>(null);
  const [suppression, setSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
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
      setSelectedUser(null);
      setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
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
  const selectionOnly = Boolean(onSelect && !onApply);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl, maxHeight: "70%", flexShrink: 1 }}>
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
            onPress={() => {
              if (selectionOnly) onUnassign?.();
              else setSelectedUser({ id: null, name: null });
            }}
            style={({ pressed }) => ({
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              marginHorizontal: spacing.lg,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: selectedUser?.id === null ? colors.primary : colors.border,
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
                  onPress={() => {
                    if (selectionOnly) onSelect?.(user.user_id, displayName);
                    else setSelectedUser({ id: user.user_id, name: displayName });
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selectedUser?.id === user.user_id ? colors.primary : colors.border,
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
        {!selectionOnly ? <View style={{ paddingHorizontal: spacing.lg }}>
          {selectedUser ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>
              {selectedUser.id
                ? t("agentPicker.selected", "Selected: {{name}}", { name: selectedUser.name })
                : t("agentPicker.unassignSelected", "The ticket will be unassigned")}
            </Text>
          ) : null}
          <TicketUpdateFooter
            suppression={suppression}
            onSuppressionChange={setSuppression}
            onCancel={onClose}
            onApply={() => {
              if (!selectedUser) return;
              const commit = () => onApply?.(selectedUser.id, activeTicketNotificationSuppression(suppression));
              if (selectedUser.id === null) {
                Alert.alert(
                  t("confirm.unassignTitle", "Unassign this ticket?"),
                  t("confirm.unassignMessage", "The ticket will no longer have a primary assignee."),
                  [
                    { text: t("common:cancel"), style: "cancel" },
                    { text: t("agentPicker.unassign"), style: "destructive", onPress: commit },
                  ],
                );
              } else if (currentAssignedToId && selectedUser.id !== currentAssignedToId) {
                Alert.alert(
                  t("confirm.reassignTitle", "Replace the current assignee?"),
                  t("confirm.reassignMessage", "This ticket is already assigned. The selected agent will replace the current assignee."),
                  [
                    { text: t("common:cancel"), style: "cancel" },
                    { text: t("confirm.reassignAction", "Replace assignee"), onPress: commit },
                  ],
                );
              } else {
                commit();
              }
            }}
            applyLabel={selectedUser?.id === null ? t("agentPicker.unassign") : t("agentPicker.apply", "Assign")}
            applyDisabled={!selectedUser || selectedUser.id === currentAssignedToId}
            busy={busy}
          />
        </View> : null}
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
