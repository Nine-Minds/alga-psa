import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { Avatar } from "../../../ui/components/Avatar";
import { listContacts, type ContactListItem } from "../../../api/referenceData";
import type { ApiClient } from "../../../api/client";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "./TicketUpdateFooter";

export function ContactPickerModal({
  visible,
  updating,
  updateError,
  currentContactId,
  currentContactName,
  clientId,
  onApply,
  onClose,
  client,
  apiKey,
  baseUrl,
}: {
  visible: boolean;
  updating: boolean;
  updateError: string | null;
  currentContactId: string | null | undefined;
  currentContactName: string | null | undefined;
  clientId: string | null | undefined;
  onApply: (contactNameId: string | null, notificationSuppression: ReturnType<typeof activeTicketNotificationSuppression>) => void;
  onClose: () => void;
  client: ApiClient | null;
  apiKey: string;
  baseUrl: string | null;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");

  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<{ id: string | null; name: string | null } | null>(null);
  const [suppression, setSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchContacts = useCallback(async (query: string) => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await listContacts(client, {
        apiKey,
        clientId: clientId ?? undefined,
        search: query || undefined,
        limit: 50,
        signal: controller.signal,
      });
      if (!res.ok) {
        setError(t("contactPicker.unableToLoad"));
        return;
      }
      // Deduplicate
      const seen = new Set<string>();
      const unique = res.data.data.filter((c) => {
        if (seen.has(c.contact_name_id)) return false;
        seen.add(c.contact_name_id);
        return true;
      });
      setContacts(unique);
    } catch {
      if (!controller.signal.aborted) {
        setError(t("contactPicker.unableToLoad"));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [client, apiKey, clientId, t]);

  useEffect(() => {
    if (visible) {
      setSearch("");
      setSelectedContact(null);
      setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
      void fetchContacts("");
    } else {
      abortRef.current?.abort();
      setContacts([]);
      setError(null);
    }
  }, [visible, fetchContacts]);

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void fetchContacts(text.trim());
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
          <Text style={{ ...typography.title, color: colors.text }}>{t("contactPicker.title")}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} hitSlop={12}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>{t("common:close")}</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <TextInput
            placeholder={t("contactPicker.searchPlaceholder")}
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

        {currentContactName ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("contactPicker.remove")}
            disabled={busy}
            onPress={() => setSelectedContact({ id: null, name: null })}
            style={({ pressed }) => ({
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              marginHorizontal: spacing.lg,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: selectedContact?.id === null ? colors.primary : colors.border,
              backgroundColor: colors.card,
              opacity: busy ? 0.65 : pressed ? 0.95 : 1,
              marginBottom: spacing.sm,
            })}
          >
            <Text style={{ ...typography.body, color: colors.danger }}>
              {t("contactPicker.remove")}
            </Text>
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
              {t("contactPicker.currentContact", { name: currentContactName })}
            </Text>
          </Pressable>
        ) : null}

        {updateError ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger, marginBottom: spacing.sm }}>
            {updateError}
          </Text>
        ) : null}

        {loading && contacts.length === 0 ? (
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
            {contacts.length === 0 && !loading ? (
              <Text style={{ ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm }}>
                {t("contactPicker.noResults")}
              </Text>
            ) : null}
            {contacts.map((contact) => {
              const avatarUri = contact.avatarUrl && baseUrl ? `${baseUrl}${contact.avatarUrl}` : undefined;
              return (
                <Pressable
                  key={contact.contact_name_id}
                  accessibilityRole="button"
                  accessibilityLabel={t("contactPicker.selectContact", { name: contact.full_name })}
                  disabled={busy}
                  onPress={() => setSelectedContact({ id: contact.contact_name_id, name: contact.full_name })}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selectedContact?.id === contact.contact_name_id ? colors.primary : colors.border,
                    backgroundColor: colors.card,
                    opacity: busy ? 0.65 : pressed ? 0.95 : 1,
                    marginBottom: spacing.sm,
                  })}
                >
                  <Avatar name={contact.full_name} imageUri={avatarUri} size="sm" />
                  <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                    <Text style={{ ...typography.body, color: colors.text }}>{contact.full_name}</Text>
                    {contact.email ? (
                      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{contact.email}</Text>
                    ) : null}
                  </View>
                  {busy ? <ActivityIndicator size="small" /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <View style={{ paddingHorizontal: spacing.lg }}>
          {selectedContact ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>
              {selectedContact.id
                ? t("contactPicker.selected", "Selected: {{name}}", { name: selectedContact.name })
                : t("contactPicker.removeSelected", "The contact will be removed")}
            </Text>
          ) : null}
          <TicketUpdateFooter
            suppression={suppression}
            onSuppressionChange={setSuppression}
            onCancel={onClose}
            onApply={() => {
              if (!selectedContact) return;
              const commit = () => onApply(selectedContact.id, activeTicketNotificationSuppression(suppression));
              if (selectedContact.id === null) {
                Alert.alert(
                  t("confirm.removeContactTitle", "Remove this contact?"),
                  t("confirm.removeContactMessage", "The ticket will no longer be linked to its current contact."),
                  [
                    { text: t("common:cancel"), style: "cancel" },
                    { text: t("contactPicker.remove"), style: "destructive", onPress: commit },
                  ],
                );
              } else {
                commit();
              }
            }}
            applyLabel={selectedContact?.id === null ? t("contactPicker.remove") : t("contactPicker.apply", "Change contact")}
            applyDisabled={!selectedContact || selectedContact.id === currentContactId}
            busy={busy}
          />
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
