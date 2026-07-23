import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { loseOpportunity, type OpportunityLossReason } from "../../../api/opportunities";
import { useTheme } from "../../../ui/ThemeContext";
import { useToast } from "../../../ui/toast/ToastProvider";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { TextInput } from "../../../ui/components/TextInput";
import { Select, type SelectOption } from "../../../ui/components/Select";
import { SecondaryButton } from "./SecondaryButton";
import { serverErrorMessage } from "../opportunityErrors";

const LOSS_REASONS: OpportunityLossReason[] = [
  "no_response",
  "chose_competitor",
  "price",
  "timing",
  "no_budget",
  "not_a_fit",
  "other",
];

export function LoseOpportunityModal({
  visible,
  client,
  apiKey,
  opportunityId,
  onClose,
  onLost,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  opportunityId: string;
  onClose: () => void;
  onLost: () => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const { showToast } = useToast();

  const [reason, setReason] = useState<OpportunityLossReason | null>(null);
  const [lostTo, setLostTo] = useState("");
  const [notes, setNotes] = useState("");
  const [selectOpen, setSelectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason(null);
      setLostTo("");
      setNotes("");
      setSelectOpen(false);
      setSubmitting(false);
      setError(null);
    }
  }, [visible]);

  const reasonOptions = useMemo<SelectOption<OpportunityLossReason>[]>(
    () => LOSS_REASONS.map((value) => ({ label: t(`lost.reasons.${value}`, value), value })),
    [t],
  );
  const reasonLabel = reason ? t(`lost.reasons.${reason}`, reason) : null;
  const showLostTo = reason === "chose_competitor";
  const canSubmit = !submitting && reason !== null;

  const handleSubmit = useCallback(async () => {
    if (!client || !apiKey || !reason) return;
    setSubmitting(true);
    setError(null);
    const result = await loseOpportunity(client, {
      apiKey,
      opportunityId,
      data: {
        loss_reason: reason,
        loss_notes: notes.trim() || undefined,
        ...(showLostTo && lostTo.trim() ? { lost_to: lostTo.trim() } : {}),
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    showToast({ message: t("lost.success", "Deal marked lost"), tone: "success" });
    onLost();
    onClose();
  }, [apiKey, client, lostTo, notes, onClose, onLost, opportunityId, reason, showLostTo, showToast, t]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{t("lost.title", "Mark lost")}</Text>

        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
          {t("lost.reason", "Reason")}
        </Text>
        <Pressable
          testID="lose-opportunity-reason-trigger"
          onPress={() => setSelectOpen(true)}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={reasonLabel ?? t("lost.selectReason", "Select a reason")}
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
          <Text style={{ ...theme.typography.body, color: reasonLabel ? theme.colors.text : theme.colors.placeholder }}>
            {reasonLabel ?? t("lost.selectReason", "Select a reason")}
          </Text>
          <Feather name="chevron-down" size={18} color={theme.colors.textSecondary} />
        </Pressable>

        {showLostTo ? (
          <View style={{ marginTop: theme.spacing.lg }}>
            <TextInput
              label={t("lost.lostTo", "Lost to")}
              value={lostTo}
              onChangeText={setLostTo}
              disabled={submitting}
              accessibilityLabel={t("lost.lostTo", "Lost to")}
            />
          </View>
        ) : null}

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("lost.notes", "Notes")}
            value={notes}
            onChangeText={setNotes}
            multiline
            minHeight={90}
            disabled={submitting}
            accessibilityLabel={t("lost.notes", "Notes")}
          />
        </View>

        {error ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{error}</Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <PrimaryButton
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            accessibilityLabel={t("lost.confirm", "Mark lost")}
          >
            {t("lost.confirm", "Mark lost")}
          </PrimaryButton>
          <View style={{ flexDirection: "row" }}>
            <SecondaryButton
              testID="lose-opportunity-cancel"
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
        value={reason}
        options={reasonOptions}
        title={t("lost.reason", "Reason")}
        onSelect={(value) => setReason(value)}
        onClose={() => setSelectOpen(false)}
      />
    </Modal>
  );
}
