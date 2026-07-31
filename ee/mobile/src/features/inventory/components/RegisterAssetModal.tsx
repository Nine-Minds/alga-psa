import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { createAsset } from "../../../api/assets";
import { listClients, type ClientListItem } from "../../../api/clients";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge, PrimaryButton, Separator, TextInput } from "../../../ui/components";

/** The standard asset types the web asset manager offers. */
const ASSET_TYPES = ["workstation", "server", "network_device", "mobile_device", "printer", "unknown"] as const;

/**
 * Field registration: a tech scans a device (usually its serial sticker) that
 * exists physically at a client site but not in the system. This creates the
 * managed asset directly — no stock/product involved.
 */
export function RegisterAssetModal({
  visible,
  client,
  apiKey,
  code,
  onClose,
  onCreated,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  code: string;
  onClose: () => void;
  onCreated: (assetId: string, name: string) => void;
}) {
  const { t } = useTranslation("inventory");
  const theme = useTheme();

  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null);
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<(typeof ASSET_TYPES)[number]>("workstation");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchClients = useCallback(
    async (term: string) => {
      if (!client || !apiKey) return;
      setClientsLoading(true);
      setClientsError(false);
      const result = await listClients(client, { apiKey, page: 1, search: term || undefined, limit: 25 });
      setClientsLoading(false);
      if (!result.ok) {
        if (result.error.kind !== "canceled") setClientsError(true);
        return;
      }
      setClients(result.data.data);
    },
    [apiKey, client],
  );

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setSelectedClient(null);
    setName("");
    setAssetType("workstation");
    setSubmitError(null);
    void fetchClients("");
  }, [fetchClients, visible]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((item) => item.client_name.toLowerCase().includes(term));
  }, [clients, search]);

  const submit = useCallback(async () => {
    if (!client || !apiKey || !selectedClient || submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setSubmitError(t("registerAsset.nameRequired", "Give the device a name."));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await createAsset(client, {
      apiKey,
      data: {
        client_id: selectedClient.client_id,
        asset_type: assetType,
        asset_tag: code,
        serial_number: code,
        name: trimmed,
        status: "active",
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error.message || t("registerAsset.error", "Couldn't register the asset."));
      return;
    }
    onCreated(result.data.data.asset_id, trimmed);
  }, [apiKey, assetType, client, code, name, onCreated, selectedClient, submitting, t]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("registerAsset.title", "Register as an asset")}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
          {t("registerAsset.serialLine", "Serial / tag: {{code}}", { code })}
        </Text>

        {selectedClient === null ? (
          <>
            <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
              {t("registerAsset.pickClient", "Whose device is this?")}
            </Text>
            <View style={{ marginTop: theme.spacing.md }}>
              <TextInput
                value={search}
                onChangeText={(text) => {
                  setSearch(text);
                  void fetchClients(text);
                }}
                placeholder={t("registerAsset.searchClients", "Search clients")}
                autoCorrect={false}
                accessibilityLabel="inventory-register-client-search"
              />
            </View>
            <View style={{ marginTop: theme.spacing.md }}>
              {clientsError ? (
                <Text style={{ ...theme.typography.body, color: theme.colors.danger }}>
                  {t("registerAsset.clientsError", "Couldn't load clients.")}
                </Text>
              ) : clientsLoading && filtered.length === 0 ? (
                <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
                  {t("registerAsset.loading", "Loading clients…")}
                </Text>
              ) : filtered.length === 0 ? (
                <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
                  {t("registerAsset.noClients", "No clients found.")}
                </Text>
              ) : (
                filtered.map((item, index) => (
                  <View key={item.client_id}>
                    {index > 0 ? <Separator /> : null}
                    <Pressable
                      onPress={() => setSelectedClient(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`inventory-register-client-${item.client_id}`}
                      testID={`inventory-register-client-${item.client_id}`}
                      style={({ pressed }) => ({ paddingVertical: theme.spacing.md, opacity: pressed ? 0.7 : 1 })}
                    >
                      <Text style={{ ...theme.typography.bodyBold, color: theme.colors.text }}>{item.client_name}</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t("registerAsset.clientLabel", "Client")}
              </Text>
              <Badge label={selectedClient.client_name} />
              <Text
                onPress={() => setSelectedClient(null)}
                testID="inventory-register-change-client"
                style={{ ...theme.typography.caption, color: theme.colors.primary }}
              >
                {t("registerAsset.changeClient", "Change")}
              </Text>
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              label={t("registerAsset.nameLabel", "Device name")}
              placeholder={t("registerAsset.namePlaceholder", "e.g. Front desk workstation")}
              accessibilityLabel="inventory-register-name"
            />
            <View>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
                {t("registerAsset.typeLabel", "Type")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
                {ASSET_TYPES.map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setAssetType(type)}
                    accessibilityRole="button"
                    accessibilityLabel={`inventory-register-type-${type}`}
                    testID={`inventory-register-type-${type}`}
                    style={{
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.xs,
                      borderRadius: theme.borderRadius.md,
                      borderWidth: 1,
                      borderColor: assetType === type ? theme.colors.primary : theme.colors.border,
                      backgroundColor: assetType === type ? theme.colors.primary : theme.colors.card,
                    }}
                  >
                    <Text
                      style={{
                        ...theme.typography.caption,
                        color: assetType === type ? theme.colors.card : theme.colors.text,
                      }}
                    >
                      {t(`registerAsset.types.${type}`, type.replace(/_/g, " "))}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {submitError ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.danger }} testID="inventory-register-error">
                {submitError}
              </Text>
            ) : null}
            <PrimaryButton
              onPress={() => void submit()}
              disabled={submitting || name.trim().length === 0}
              accessibilityLabel="inventory-register-submit"
            >
              {t("registerAsset.submit", "Register asset")}
            </PrimaryButton>
          </View>
        )}

        <View style={{ marginTop: theme.spacing.xl }}>
          <Text
            onPress={onClose}
            testID="inventory-register-cancel"
            style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.sm }}
          >
            {t("common.cancel", "Cancel")}
          </Text>
        </View>
      </ScrollView>
    </Modal>
  );
}
