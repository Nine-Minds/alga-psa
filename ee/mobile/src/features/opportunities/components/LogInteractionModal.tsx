import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { createInteraction, listInteractionTypes, type InteractionType } from "../../../api/interactions";
import { useTheme } from "../../../ui/ThemeContext";
import { useToast } from "../../../ui/toast/ToastProvider";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TextInput } from "../../../ui/components/TextInput";
import { Select, type SelectOption } from "../../../ui/components/Select";
import { SecondaryButton } from "./SecondaryButton";
import { serverErrorMessage } from "../opportunityErrors";

export function LogInteractionModal({
  visible,
  client,
  apiKey,
  opportunityId,
  clientId,
  contactNameId,
  initialDuration,
  preferTypeName,
  onClose,
  onLogged,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  opportunityId: string;
  clientId?: string | null;
  contactNameId?: string | null;
  initialDuration?: number;
  preferTypeName?: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const { showToast } = useToast();

  const [types, setTypes] = useState<InteractionType[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle("");
    setNotes("");
    setDuration(initialDuration != null ? String(initialDuration) : "");
    setTypeId(null);
    setError(null);
    setSubmitting(false);

    if (!client || !apiKey) return;
    let canceled = false;
    setTypesLoading(true);
    void (async () => {
      const result = await listInteractionTypes(client, { apiKey });
      if (canceled) return;
      setTypesLoading(false);
      if (!result.ok) return;
      const loaded = result.data.data;
      setTypes(loaded);
      if (preferTypeName) {
        const preferred =
          loaded.find((type) => type.type_name.toLowerCase() === preferTypeName.toLowerCase()) ?? loaded[0];
        if (preferred) setTypeId(preferred.type_id);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, initialDuration, preferTypeName, visible]);

  const typeOptions = useMemo<SelectOption<string>[]>(
    () => types.map((type) => ({ label: type.type_name, value: type.type_id })),
    [types],
  );
  const selectedTypeName = types.find((type) => type.type_id === typeId)?.type_name ?? null;

  const canSubmit = !submitting && typeId !== null;

  const handleSubmit = useCallback(async () => {
    if (!client || !apiKey || !typeId) return;
    const parsedDuration = Number.parseInt(duration, 10);
    setSubmitting(true);
    setError(null);
    const result = await createInteraction(client, {
      apiKey,
      data: {
        type_id: typeId,
        title: title.trim() || undefined,
        notes: notes.trim() || undefined,
        duration: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined,
        opportunity_id: opportunityId,
        client_id: clientId ?? undefined,
        contact_name_id: contactNameId ?? undefined,
        interaction_date: new Date().toISOString(),
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    showToast({ message: t("logInteraction.success", "Interaction logged"), tone: "success" });
    onLogged();
    onClose();
  }, [apiKey, client, clientId, contactNameId, duration, notes, onClose, onLogged, opportunityId, showToast, t, title, typeId]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("logInteraction.title", "Log interaction")}
        </Text>

        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
          {t("logInteraction.type", "Type")}
        </Text>
        <Pressable
          testID="log-interaction-type-trigger"
          onPress={() => setSelectOpen(true)}
          disabled={submitting || typesLoading}
          accessibilityRole="button"
          accessibilityLabel={selectedTypeName ?? t("logInteraction.selectType", "Select a type")}
          style={({ pressed }) => ({
            marginTop: theme.spacing.sm,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.card,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ ...theme.typography.body, color: selectedTypeName ? theme.colors.text : theme.colors.placeholder }}>
            {selectedTypeName ?? t("logInteraction.selectType", "Select a type")}
          </Text>
          <Feather name="chevron-down" size={18} color={theme.colors.textSecondary} />
        </Pressable>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("logInteraction.titleField", "Title")}
            value={title}
            onChangeText={setTitle}
            disabled={submitting}
            accessibilityLabel={t("logInteraction.titleField", "Title")}
          />
        </View>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("logInteraction.notes", "Notes")}
            value={notes}
            onChangeText={setNotes}
            multiline
            minHeight={90}
            disabled={submitting}
            accessibilityLabel={t("logInteraction.notes", "Notes")}
          />
        </View>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("logInteraction.duration", "Duration (minutes)")}
            value={duration}
            onChangeText={setDuration}
            keyboardType="number-pad"
            disabled={submitting}
            accessibilityLabel={t("logInteraction.duration", "Duration (minutes)")}
          />
        </View>

        {error ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <PrimaryButton
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            accessibilityLabel={t("logInteraction.submit", "Log it")}
          >
            {t("logInteraction.submit", "Log it")}
          </PrimaryButton>
          <View style={{ flexDirection: "row" }}>
            <SecondaryButton
              testID="log-interaction-cancel"
              onPress={onClose}
              disabled={submitting}
              accessibilityLabel={t("common.cancel", "Cancel")}
            >
              {t("common.cancel", "Cancel")}
            </SecondaryButton>
          </View>
        </View>
      </ScrollView>

      <Select
        visible={selectOpen}
        value={typeId}
        options={typeOptions}
        title={t("logInteraction.type", "Type")}
        onSelect={(value) => setTypeId(value)}
        onClose={() => setSelectOpen(false)}
      />
    </Modal>
  );
}
