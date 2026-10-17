import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { EntityPickerModal, type EntityPickerItem } from "../ui/components/EntityPickerModal";
import { ErrorState } from "../ui/states";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { listAssetStatuses, listAssets, type AssetStatusKind, type AssetStatusOption } from "../api/assets";
import { startAssetAudit } from "../api/assetAudits";
import { listClients, type ClientListItem } from "../api/clients";
import { listClientLocations, type LocationListItem } from "../api/referenceData";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "AuditSetup">;

const KIND_ORDER: AssetStatusKind[] = ["deployable", "pending", "undeployable", "archived"];

/** What a walk-the-site audit expects to find: deployable plus pending kinds. */
export function defaultAuditStatuses(statuses: AssetStatusOption[]): string[] {
  return statuses
    .filter((status) => status.kind === "deployable" || status.kind === "pending")
    .map((status) => status.slug);
}

/** The "No location" choice; the API takes null for "assets with no location". */
export const NO_LOCATION_ID = "__none__";

export function AuditSetupScreen({ navigation }: Props) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/audit",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const apiKey = session?.accessToken;

  const [statuses, setStatuses] = useState<AssetStatusOption[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [locations, setLocations] = useState<LocationListItem[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !apiKey) return;
    let canceled = false;
    void (async () => {
      const result = await listAssetStatuses(client, { apiKey });
      if (canceled || !result.ok) return;
      const rows = result.data.data ?? [];
      setStatuses(rows);
      setSelectedStatuses(defaultAuditStatuses(rows));
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client]);

  const loadClients = useCallback(
    async (search?: string) => {
      if (!client || !apiKey) return;
      setClientsLoading(true);
      const result = await listClients(client, { apiKey, page: 1, limit: 50, search: search || undefined });
      setClientsLoading(false);
      if (result.ok) setClients(result.data.data);
    },
    [apiKey, client],
  );

  const loadLocations = useCallback(
    async (forClient: string) => {
      if (!client || !apiKey) return;
      setLocationsLoading(true);
      const result = await listClientLocations(client, { apiKey, clientId: forClient });
      setLocationsLoading(false);
      setLocations(result.ok ? result.data.data ?? [] : []);
    },
    [apiKey, client],
  );

  // A dry one-row request answers "how many devices will this audit expect?"
  // without pulling the list.
  useEffect(() => {
    if (!client || !apiKey || !clientId) {
      setExpectedCount(null);
      return;
    }
    let canceled = false;
    void (async () => {
      setCounting(true);
      const result = await listAssets(client, {
        apiKey,
        page: 1,
        limit: 1,
        client_id: clientId,
        location_id: locationId && locationId !== NO_LOCATION_ID ? locationId : undefined,
        status: selectedStatuses.length === 1 ? selectedStatuses[0] : undefined,
      });
      if (canceled) return;
      setCounting(false);
      setExpectedCount(result.ok ? result.data.pagination.total : null);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, clientId, locationId, selectedStatuses]);

  const start = useCallback(async () => {
    if (!client || !apiKey || !clientId) return;
    setStarting(true);
    setError(null);
    const result = await startAssetAudit(client, {
      apiKey,
      data: {
        client_id: clientId,
        location_id: locationId && locationId !== NO_LOCATION_ID ? locationId : null,
        statuses: selectedStatuses,
      },
    });
    setStarting(false);
    if (!result.ok) {
      logger.warn("Audit start failed", { error: result.error });
      setError(t("audit.startFailed", "Unable to start the audit."));
      return;
    }
    navigation.replace("AuditSession", { auditId: result.data.data.audit_id });
  }, [apiKey, client, clientId, locationId, navigation, selectedStatuses, t]);

  if (!config.ok) {
    return <ErrorState title={t("errors.configuration", "Configuration error")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("errors.signedOut", "Signed out")} />;
  }

  const statusesByKind = KIND_ORDER.map((kind) => ({
    kind,
    statuses: statuses.filter((status) => status.kind === kind),
  })).filter((group) => group.statuses.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        <Row
          testID="audit-setup-client"
          label={t("list.client", "Client")}
          value={clientName ?? t("audit.pickClient", "Pick a client")}
          onPress={() => {
            setClientPickerOpen(true);
            void loadClients();
          }}
        />
        <Row
          testID="audit-setup-location"
          label={t("list.location", "Location")}
          value={locationName ?? t("audit.anyLocation", "All of this client's devices")}
          disabled={!clientId}
          onPress={() => {
            if (!clientId) return;
            setLocationPickerOpen(true);
            void loadLocations(clientId);
          }}
        />

        <Text
          style={{
            ...theme.typography.caption,
            color: theme.colors.textSecondary,
            fontWeight: "700",
            marginTop: theme.spacing.lg,
          }}
        >
          {t("audit.statusScope", "Statuses in scope")}
        </Text>
        {statusesByKind.map((group) => (
          <View key={group.kind} style={{ marginTop: theme.spacing.sm }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t(`list.statusKind.${group.kind}`, group.kind)}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: 4 }}>
              {group.statuses.map((status) => {
                const selected = selectedStatuses.includes(status.slug);
                return (
                  <Pressable
                    key={status.slug}
                    testID={`audit-setup-status-${status.slug}`}
                    onPress={() =>
                      setSelectedStatuses((current) =>
                        selected ? current.filter((slug) => slug !== status.slug) : [...current, status.slug],
                      )
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={status.label}
                    style={{
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.xs,
                      borderRadius: theme.borderRadius.full,
                      borderWidth: 1,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      backgroundColor: selected ? theme.colors.primary : theme.colors.card,
                    }}
                  >
                    <Text
                      style={{
                        ...theme.typography.caption,
                        fontWeight: "600",
                        color: selected ? theme.colors.textInverse : theme.colors.text,
                      }}
                    >
                      {status.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {clientId ? (
          <Text
            testID="audit-setup-expected"
            style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.lg }}
          >
            {counting
              ? t("audit.counting", "Counting devices…")
              : expectedCount == null
                ? t("audit.countUnknown", "Device count unavailable.")
                : t("audit.expected", "{{count}} devices expected", { count: expectedCount })}
          </Text>
        ) : null}

        {error ? (
          <Text
            testID="audit-setup-error"
            style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}
          >
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View style={{ padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
        <PrimaryButton
          testID="audit-setup-start"
          onPress={() => void start()}
          disabled={!clientId || starting}
        >
          {t("audit.start", "Start audit")}
        </PrimaryButton>
      </View>

      <EntityPickerModal
        visible={clientPickerOpen}
        title={t("list.selectClient", "Select a client")}
        items={clients.map<EntityPickerItem>((item) => ({
          id: item.client_id,
          label: item.client_name,
          imageUri: item.logoUrl,
        }))}
        loading={clientsLoading}
        error={null}
        selectedId={clientId}
        authToken={apiKey}
        onSearch={(value) => void loadClients(value)}
        onSelect={(id, label) => {
          setClientId(id);
          setClientName(label);
          setLocationId(null);
          setLocationName(null);
          setClientPickerOpen(false);
        }}
        onClose={() => setClientPickerOpen(false)}
      />
      <EntityPickerModal
        visible={locationPickerOpen}
        title={t("list.selectLocation", "Select a location")}
        items={[
          { id: NO_LOCATION_ID, label: t("audit.noLocation", "No location") },
          ...locations.map<EntityPickerItem>((location) => ({
            id: location.location_id,
            label: location.location_name ?? location.address_line1 ?? location.location_id,
            subtitle: location.city ?? null,
          })),
        ]}
        loading={locationsLoading}
        error={null}
        selectedId={locationId}
        onSelect={(id, label) => {
          setLocationId(id);
          setLocationName(label);
          setLocationPickerOpen(false);
        }}
        onClose={() => setLocationPickerOpen(false)}
      />
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: theme.spacing.md,
        padding: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
        <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
    </Pressable>
  );
}
