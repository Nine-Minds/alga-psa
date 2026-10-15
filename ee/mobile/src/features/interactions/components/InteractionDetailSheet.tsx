import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { updateInteraction, type InteractionItem, type InteractionStatus } from "../../../api/interactions";
import { logger } from "../../../logging/logger";
import { Badge } from "../../../ui/components/Badge";
import { BottomSheet } from "../../../ui/components/BottomSheet";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { useTheme } from "../../../ui/ThemeContext";
import { InteractionEntryContext } from "../../schedule/components/InteractionEntryContext";

function DetailLine({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();
  return (
    <View>
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/** Pick the status a "mark done" / "reopen" tap should apply. */
export function pickTargetStatus(statuses: InteractionStatus[], closing: boolean): InteractionStatus | null {
  const candidates = statuses.filter((status) => status.is_closed === closing);
  return candidates.find((status) => status.is_default) ?? candidates[0] ?? null;
}

export function InteractionDetailSheet({
  interaction,
  statuses,
  client,
  apiKey,
  onClose,
  onUpdated,
  onOpenTicket,
  onOpenClient,
  onOpenContact,
}: {
  interaction: InteractionItem | null;
  statuses: InteractionStatus[];
  client: ApiClient | null;
  apiKey: string | null;
  onClose: () => void;
  onUpdated: (interaction: InteractionItem) => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenClient?: (clientId: string, clientName: string) => void;
  onOpenContact?: (contactId: string, contactName: string) => void;
}) {
  const { t } = useTranslation("interactions");
  const { colors, spacing, typography } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosed = Boolean(interaction?.is_status_closed);
  const target = pickTargetStatus(statuses, !isClosed);

  const toggleDone = async () => {
    if (!client || !apiKey || !interaction) return;
    if (!target) {
      setError(t("detail.noClosedStatus"));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateInteraction(client, { apiKey, interactionId: interaction.interaction_id, data: { status_id: target.status_id } });
    setSaving(false);
    if (!result.ok) {
      logger.warn("[InteractionDetailSheet] status update failed", { error: result.error });
      setError(t("detail.markDoneFailed"));
      return;
    }
    onUpdated(result.data.data);
  };

  return (
    <BottomSheet
      visible={interaction !== null}
      onClose={onClose}
      title={interaction?.title || interaction?.type_name || t("detail.interaction")}
      snapPoint="full"
    >
      {interaction ? (
        <View testID="interaction-detail" style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Badge label={interaction.type_name ?? t("detail.interaction")} tone="info" />
            {interaction.status_name ? <Badge label={interaction.status_name} tone={isClosed ? "success" : "warning"} /> : null}
          </View>
          {interaction.start_time ? (
            <DetailLine label={t("detail.scheduledFor")} value={formatDateTimeWithRelative(interaction.start_time)} />
          ) : (
            <DetailLine label={t("detail.when")} value={formatDateTimeWithRelative(interaction.interaction_date)} />
          )}
          {interaction.duration ? <DetailLine label={t("detail.duration")} value={t("detail.minutes", { count: interaction.duration })} /> : null}
          {interaction.user_name ? <DetailLine label={t("detail.loggedBy")} value={interaction.user_name} /> : null}

          <InteractionEntryContext
            client={client}
            apiKey={apiKey}
            interactionId={interaction.interaction_id}
            onOpenTicket={onOpenTicket}
            onOpenClient={onOpenClient}
            onOpenContact={onOpenContact}
          />

          {error ? <Text style={{ ...typography.caption, color: colors.danger }}>{error}</Text> : null}
          <PrimaryButton
            onPress={() => void toggleDone()}
            disabled={saving || !client}
            accessibilityLabel={isClosed ? t("detail.reopen") : t("detail.markDone")}
          >
            {saving ? <ActivityIndicator size="small" color={colors.textInverse} /> : isClosed ? t("detail.reopen") : t("detail.markDone")}
          </PrimaryButton>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} style={{ alignItems: "center", padding: spacing.xs }}>
            <Text style={{ ...typography.body, color: colors.textSecondary }}>{t("common:close")}</Text>
          </Pressable>
        </View>
      ) : null}
    </BottomSheet>
  );
}
