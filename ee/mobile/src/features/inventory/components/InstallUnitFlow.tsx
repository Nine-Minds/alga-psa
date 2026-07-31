import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { addTicketMaterial, listProducts } from "../../../api/materials";
import { getStockUnit, type StockUnitSummary } from "../../../api/inventory";
import { listTickets, type TicketListItem } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge, PrimaryButton, Separator, TextInput } from "../../../ui/components";

function parseRateInput(value: string): number | null {
  const normalized = value.trim().replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/**
 * Field install: deliver an in-stock serialized unit against a ticket. The unit
 * becomes the ticket client's device — the server consumes the unit as a ticket
 * material and (when the product opts in via creates_asset_on_delivery) mints
 * the managed asset. Two steps in one modal: pick the ticket, confirm the rate.
 */
export function InstallUnitFlow({
  visible,
  client,
  apiKey,
  unit,
  onClose,
  onInstalled,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  unit: StockUnitSummary;
  onClose: () => void;
  /** assetId is null when the product does not create assets on delivery. */
  onInstalled: (assetId: string | null) => void;
}) {
  const { t } = useTranslation("inventory");
  const theme = useTheme();

  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [ticket, setTicket] = useState<TicketListItem | null>(null);
  const [rateInput, setRateInput] = useState("0.00");
  const [currency, setCurrency] = useState("USD");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setTicket(null);
    setSubmitError(null);
    if (!client || !apiKey) return;
    let canceled = false;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      const result = await listTickets(client, {
        apiKey,
        page: 1,
        limit: 50,
        filters: { is_open: true },
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
  }, [apiKey, client, visible]);

  // Prefill the material rate from the product's price list.
  useEffect(() => {
    if (!visible || !client || !apiKey) return;
    let canceled = false;
    void (async () => {
      const result = await listProducts(client, {
        apiKey,
        search: unit.service_name ?? undefined,
        limit: 20,
      });
      if (canceled || !result.ok) return;
      const product = result.data.data.find((item) => item.service_id === unit.service_id);
      if (!product) return;
      const price = product.prices?.[0];
      const rate = price?.rate ?? product.default_rate ?? 0;
      setRateInput(((rate || 0) / 100).toFixed(2));
      if (price?.currency_code) setCurrency(price.currency_code);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, unit.service_id, unit.service_name, visible]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((item) =>
      `${item.ticket_number} ${item.title} ${item.client_name ?? ""}`.toLowerCase().includes(term),
    );
  }, [search, tickets]);

  const submit = useCallback(async () => {
    if (!client || !apiKey || !ticket || submitting) return;
    const rate = parseRateInput(rateInput);
    if (rate === null) {
      setSubmitError(t("install.invalidRate", "Enter a valid rate."));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await addTicketMaterial(client, {
      apiKey,
      ticketId: ticket.ticket_id,
      data: {
        service_id: unit.service_id,
        quantity: 1,
        rate,
        currency_code: currency,
        unit_id: unit.unit_id,
      },
    });
    if (!result.ok) {
      setSubmitting(false);
      setSubmitError(result.error.message || t("install.error", "Couldn't install this unit."));
      return;
    }
    // The asset (if any) is minted post-commit; the fresh unit row carries its id.
    const refreshed = await getStockUnit(client, { apiKey, unitId: unit.unit_id });
    setSubmitting(false);
    onInstalled(refreshed.ok ? (refreshed.data.data.asset_id ?? null) : null);
  }, [apiKey, client, currency, onInstalled, rateInput, submitting, t, ticket, unit.service_id, unit.unit_id]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("install.title", "Install for a client")}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
          {unit.service_name ?? ""} · {t("unit.serial", "Serial")} {unit.serial_number}
        </Text>

        {ticket === null ? (
          <>
            <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
              {t("install.pickTicket", "Pick the ticket you're working — the device becomes that client's asset.")}
            </Text>
            <View style={{ marginTop: theme.spacing.md }}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t("install.searchTickets", "Search tickets")}
                autoCorrect={false}
                accessibilityLabel="inventory-install-ticket-search"
              />
            </View>
            <View style={{ marginTop: theme.spacing.md }}>
              {loadError ? (
                <Text style={{ ...theme.typography.body, color: theme.colors.danger }}>
                  {t("install.loadError", "Couldn't load tickets.")}
                </Text>
              ) : loading ? (
                <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
                  {t("install.loading", "Loading tickets…")}
                </Text>
              ) : filtered.length === 0 ? (
                <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
                  {t("install.noTickets", "No open tickets found.")}
                </Text>
              ) : (
                filtered.map((item, index) => (
                  <View key={item.ticket_id}>
                    {index > 0 ? <Separator /> : null}
                    <Pressable
                      onPress={() => setTicket(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`inventory-install-ticket-${item.ticket_id}`}
                      testID={`inventory-install-ticket-${item.ticket_id}`}
                      style={({ pressed }) => ({ paddingVertical: theme.spacing.md, opacity: pressed ? 0.7 : 1 })}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                        <Text style={{ ...theme.typography.bodyBold, color: theme.colors.text, flex: 1 }} numberOfLines={2}>
                          {item.title}
                        </Text>
                        {item.status_name ? <Badge label={item.status_name} /> : null}
                      </View>
                      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                        {item.ticket_number}
                        {item.client_name ? ` · ${item.client_name}` : ""}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
            <View>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("install.ticketLabel", "Ticket")}
              </Text>
              <Text style={{ ...theme.typography.bodyBold, color: theme.colors.text }}>
                {ticket.ticket_number} · {ticket.title}
              </Text>
              {ticket.client_name ? (
                <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                  {t("install.assetFor", "Asset will belong to {{client}}", { client: ticket.client_name })}
                </Text>
              ) : null}
            </View>
            <TextInput
              value={rateInput}
              onChangeText={setRateInput}
              label={t("install.rateLabel", "Rate ({{currency}})", { currency })}
              numericMode="decimal"
              accessibilityLabel="inventory-install-rate"
            />
            {submitError ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.danger }} testID="inventory-install-error">
                {submitError}
              </Text>
            ) : null}
            <PrimaryButton
              onPress={() => void submit()}
              disabled={submitting}
              accessibilityLabel="inventory-install-submit"
            >
              {t("install.submit", "Install & deliver")}
            </PrimaryButton>
            <Text
              onPress={() => setTicket(null)}
              testID="inventory-install-back"
              style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.xs }}
            >
              {t("install.changeTicket", "Choose a different ticket")}
            </Text>
          </View>
        )}

        <View style={{ marginTop: theme.spacing.xl }}>
          <Text
            onPress={onClose}
            testID="inventory-install-cancel"
            style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.sm }}
          >
            {t("common.cancel", "Cancel")}
          </Text>
        </View>
      </ScrollView>
    </Modal>
  );
}
