import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { listInteractions, type InteractionItem } from "../../../api/interactions";
import { logger } from "../../../logging/logger";
import { Badge } from "../../../ui/components/Badge";
import { BottomSheet } from "../../../ui/components/BottomSheet";
import { Card } from "../../../ui/components/Card";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { formatDateShort, formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { useTheme } from "../../../ui/ThemeContext";
import { LogInteractionModal } from "../../opportunities/components/LogInteractionModal";
import { SectionCollapseToggle } from "./SectionCollapseToggle";

const RECENT_LIMIT = 5;

function DetailLine({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const { colors, typography } = useTheme();
  return (
    <View>
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }} numberOfLines={multiline ? undefined : 2}>{value}</Text>
    </View>
  );
}

function interactionIcon(interaction: InteractionItem): keyof typeof Feather.glyphMap {
  const name = (interaction.type_name ?? "").toLowerCase();
  if (name.includes("call")) return "phone";
  if (name.includes("email")) return "mail";
  if (name.includes("meeting")) return "users";
  return "message-circle";
}

/**
 * Mobile counterpart of the web "Calls and emails" bento tile: the most
 * recent interactions logged against the ticket, plus the same log dialog
 * (with its "Add to schedule" option) for booking the next call or follow-up.
 */
export function CallsEmailsSection({
  client,
  apiKey,
  userId,
  ticketId,
  clientId,
  contactNameId,
  onLogged,
  initiallyCollapsed = false,
  reloadKey = 0,
}: {
  client: ApiClient | null;
  apiKey: string;
  userId?: string | null;
  ticketId: string;
  clientId?: string | null;
  contactNameId?: string | null;
  onLogged?: () => void;
  initiallyCollapsed?: boolean;
  /** Bump to refetch after an interaction is logged from outside the section. */
  reloadKey?: number;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();
  const [interactions, setInteractions] = useState<InteractionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [selected, setSelected] = useState<InteractionItem | null>(null);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  const load = useCallback(async () => {
    if (!client || !apiKey) return;
    setError(null);
    const result = await listInteractions(client, { apiKey, ticketId, page: 1, limit: RECENT_LIMIT });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("[CallsEmailsSection] load failed", { error: result.error });
      setError(t("callsEmails.errors.load"));
      setLoading(false);
      return;
    }
    const rows = Array.isArray(result.data.data) ? result.data.data : [];
    setInteractions(rows);
    setTotal(result.data.pagination?.total ?? rows.length);
    setLoading(false);
  }, [apiKey, client, t, ticketId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  return (
    <Card accessibilityLabel={t("callsEmails.title")}>
      <SectionHeader
        title={t("callsEmails.title")}
        action={(
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Badge label={String(total)} tone="neutral" />
            {!collapsed ? (
              <PrimaryButton onPress={() => setLogOpen(true)} accessibilityLabel={t("callsEmails.logInteraction")}>
                {t("callsEmails.log")}
              </PrimaryButton>
            ) : null}
            <SectionCollapseToggle
              collapsed={collapsed}
              onToggle={() => setCollapsed((value) => !value)}
              sectionLabel={t("callsEmails.title")}
            />
          </View>
        )}
      />

      {collapsed ? null : (
        <View style={{ marginTop: spacing.md }}>
          {loading ? (
            <View style={{ alignItems: "center" }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : error ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={{ ...typography.caption, color: colors.danger, flex: 1 }}>{error}</Text>
              <Pressable onPress={() => { setLoading(true); void load(); }} accessibilityRole="button" accessibilityLabel={t("common:retry")} hitSlop={8}>
                <Text style={{ ...typography.body, color: colors.primary }}>{t("common:retry")}</Text>
              </Pressable>
            </View>
          ) : interactions.length === 0 ? (
            <Text style={{ ...typography.body, color: colors.textSecondary }}>{t("callsEmails.empty")}</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {interactions.map((interaction) => {
                const label = interaction.title || interaction.type_name || t("callsEmails.interaction");
                const when = interaction.start_time ? formatDateShort(interaction.start_time) : formatDateShort(interaction.interaction_date);
                const meta = [interaction.type_name, interaction.user_name, when].filter(Boolean).join(" • ");
                return (
                  <Pressable
                    key={interaction.interaction_id}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}. ${meta}`}
                    onPress={() => setSelected(interaction)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.sm,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    }}
                  >
                    <Feather name={interactionIcon(interaction)} size={18} color={colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text testID={`calls-emails-row-${interaction.interaction_id}`} style={{ ...typography.body, color: colors.text }} numberOfLines={1}>
                        {label}
                      </Text>
                      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                        {meta}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={colors.textSecondary} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}

      <BottomSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title || selected?.type_name || t("callsEmails.interaction")}
        snapPoint="half"
      >
        {selected ? (
          <View testID="calls-emails-detail" style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}>
            <DetailLine label={t("callsEmails.detail.type")} value={selected.type_name ?? t("callsEmails.interaction")} />
            {selected.start_time ? (
              <DetailLine label={t("callsEmails.detail.scheduledFor")} value={formatDateTimeWithRelative(selected.start_time)} />
            ) : (
              <DetailLine label={t("callsEmails.detail.when")} value={formatDateTimeWithRelative(selected.interaction_date)} />
            )}
            {selected.status_name ? <DetailLine label={t("callsEmails.detail.status")} value={selected.status_name} /> : null}
            {selected.duration ? <DetailLine label={t("callsEmails.detail.duration")} value={t("callsEmails.detail.minutes", { count: selected.duration })} /> : null}
            {selected.user_name ? <DetailLine label={t("callsEmails.detail.loggedBy")} value={selected.user_name} /> : null}
            <DetailLine label={t("callsEmails.detail.notes")} value={selected.notes?.trim() || t("callsEmails.detail.noNotes")} multiline />
          </View>
        ) : null}
      </BottomSheet>

      <LogInteractionModal
        visible={logOpen}
        client={client}
        apiKey={apiKey}
        userId={userId}
        ticketId={ticketId}
        clientId={clientId}
        contactNameId={contactNameId}
        onClose={() => setLogOpen(false)}
        onLogged={() => {
          setLoading(true);
          void load();
          onLogged?.();
        }}
      />
    </Card>
  );
}
