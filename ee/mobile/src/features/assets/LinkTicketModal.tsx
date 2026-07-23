import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../api";
import { linkAssetToTicket } from "../../api/assets";
import { listTickets, type TicketListItem } from "../../api/tickets";
import { useTheme } from "../../ui/ThemeContext";
import { useToast } from "../../ui/toast/ToastProvider";
import { Badge, IconButton, PrimaryButton, Separator, TextInput } from "../../ui/components";

export function LinkTicketModal({
  visible,
  client,
  apiKey,
  assetId,
  clientId,
  onClose,
  onLinked,
  onCreateInstead,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  assetId: string;
  /** Scope the ticket list to the asset's owning client. */
  clientId?: string | null;
  onClose: () => void;
  onLinked: () => void;
  /** Escape hatch when the tech can't find a ticket: hand off to create-a-ticket. */
  onCreateInstead?: () => void;
}) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const { showToast } = useToast();

  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setLinkingId(null);
    if (!client || !apiKey) return;
    let canceled = false;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      const result = await listTickets(client, {
        apiKey,
        page: 1,
        limit: 50,
        filters: { is_open: true, ...(clientId ? { client_id: clientId } : {}) },
      });
      if (canceled) return;
      setLoading(false);
      if (!result.ok) {
        if (result.error.kind !== "canceled") setLoadError(true);
        return;
      }
      setTickets(result.data.data);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, clientId, visible]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((ticket) => {
      const haystack = `${ticket.ticket_number} ${ticket.title}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [search, tickets]);

  const linkTicket = useCallback(
    async (ticketId: string) => {
      if (!client || !apiKey || linkingId) return;
      setLinkingId(ticketId);
      const result = await linkAssetToTicket(client, { apiKey, ticketId, assetId });
      setLinkingId(null);
      if (!result.ok) {
        showToast({ tone: "error", message: t("linkTicket.error", "Couldn't link the ticket. Try again.") });
        return;
      }
      showToast({ tone: "success", message: t("linkTicket.success", "Ticket linked to this device") });
      onLinked();
      onClose();
    },
    [apiKey, assetId, client, linkingId, onClose, onLinked, showToast, t],
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <IconButton
            onPress={onClose}
            accessibilityLabel="asset-detail-link-ticket-back"
            icon={<Feather name="arrow-left" size={22} color={theme.colors.text} />}
          />
          <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
            {t("linkTicket.title", "Link to a ticket")}
          </Text>
        </View>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("linkTicket.search", "Search tickets")}
            autoCorrect={false}
            accessibilityLabel="asset-detail-link-ticket-search"
          />
        </View>

        <View style={{ marginTop: theme.spacing.lg }}>
          {loadError ? (
            <Text style={{ ...theme.typography.body, color: theme.colors.danger }}>
              {t("linkTicket.loadError", "Couldn't load tickets.")}
            </Text>
          ) : loading ? (
            <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
              {t("linkTicket.loading", "Loading tickets…")}
            </Text>
          ) : filtered.length === 0 ? (
            <View style={{ gap: theme.spacing.md }}>
              <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
                {t("linkTicket.empty", "No open tickets for this client.")}
              </Text>
              {onCreateInstead ? (
                <PrimaryButton onPress={onCreateInstead} accessibilityLabel="asset-detail-link-ticket-create-instead-empty">
                  {t("linkTicket.createInstead", "Create a ticket")}
                </PrimaryButton>
              ) : null}
            </View>
          ) : (
            filtered.map((ticket, index) => (
              <View key={ticket.ticket_id}>
                {index > 0 ? <Separator /> : null}
                <Pressable
                  onPress={() => void linkTicket(ticket.ticket_id)}
                  disabled={linkingId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`asset-detail-link-ticket-option-${ticket.ticket_id}`}
                  testID={`asset-detail-link-ticket-option-${ticket.ticket_id}`}
                  style={({ pressed }) => ({
                    paddingVertical: theme.spacing.md,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                    <Text style={{ ...theme.typography.bodyBold, color: theme.colors.text, flex: 1 }} numberOfLines={2}>
                      {ticket.title}
                    </Text>
                    {ticket.status_name ? <Badge label={ticket.status_name} /> : null}
                  </View>
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                    {ticket.ticket_number}
                    {ticket.client_name ? ` · ${ticket.client_name}` : ""}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        {onCreateInstead && filtered.length > 0 ? (
          <Text
            onPress={onCreateInstead}
            testID="asset-detail-link-ticket-create-instead"
            accessibilityRole="button"
            style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.md, marginTop: theme.spacing.md }}
          >
            {t("linkTicket.cantFind", "Can't find it? Create a ticket")}
          </Text>
        ) : null}
      </ScrollView>
    </Modal>
  );
}
