import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge, ListRow, PrimaryButton, Select, Separator } from "../../../ui/components";
import { EmptyState, ErrorState, LoadingState } from "../../../ui/states";
import {
  listCountSessions,
  listStockLocations,
  startCountSession,
  type CountSessionSummary,
  type StockLocation,
} from "../../../api/inventory";
import { useInventoryApi } from "../hooks/useInventoryApi";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { useToast } from "../../../ui/toast/ToastProvider";
import type { RootStackParamList } from "../../../navigation/types";

const PAGE_SIZE = 30;

function countStatusTone(status: string): "neutral" | "info" | "success" | "warning" {
  if (status === "review") return "info";
  if (status === "approved") return "success";
  if (status === "in_progress") return "warning";
  return "neutral";
}

export function CountsView() {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client, apiKey } = useInventoryApi();
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<CountSessionSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-access">("loading");
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [startLocationId, setStartLocationId] = useState<string | null>(null);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await listCountSessions(client, { apiKey, page: 1, limit: PAGE_SIZE, signal: controller.signal });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      setStatus(result.error.kind === "permission" ? "no-access" : "error");
      return;
    }
    setSessions(result.data.data);
    setStatus("ready");
  }, [client, apiKey]);

  useEffect(() => {
    void fetchSessions();
    return () => abortRef.current?.abort();
  }, [fetchSessions]);

  useEffect(() => {
    if (!client || !apiKey) return;
    void listStockLocations(client, { apiKey }).then((result) => {
      if (result.ok) setLocations(result.data.data);
    });
  }, [client, apiKey]);

  const { refreshing, refresh } = usePullToRefresh(fetchSessions);

  const onStart = useCallback(async () => {
    if (!client || !apiKey || !startLocationId) return;
    setStarting(true);
    const result = await startCountSession(client, { apiKey, data: { location_id: startLocationId } });
    setStarting(false);
    if (result.ok) {
      const session = result.data.data;
      navigation.navigate("CountSession", { sessionId: session.session_id, locationName: session.location_name });
      void fetchSessions();
      return;
    }
    const status = "status" in result.error ? result.error.status : undefined;
    if (status === 409) {
      // Only one open count per location: a conflict means one already exists,
      // so resume it instead of surfacing an error.
      const existingSessions = await listCountSessions(client, { apiKey, page: 1, limit: 50 });
      const open = existingSessions.ok
        ? existingSessions.data.data.find(
            (session) => session.location_id === startLocationId && session.status === "in_progress",
          )
        : undefined;
      if (open) {
        showToast({ tone: "info", message: t("counts.resumingOpen", "Resuming the open count for this location") });
        navigation.navigate("CountSession", { sessionId: open.session_id, locationName: open.location_name });
        return;
      }
    }
    showToast({
      tone: "error",
      message: result.error.message || t("scan.lookupFailed", "Lookup failed. Try again."),
    });
  }, [client, apiKey, startLocationId, navigation, showToast, t, fetchSessions]);

  if (status === "no-access") {
    return <EmptyState title={t("common.noAccess", "You don't have access to inventory.")} />;
  }
  if (status === "error") {
    return (
      <ErrorState
        action={
          <Text onPress={() => void fetchSessions()} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }
  if (status === "loading") return <LoadingState />;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
        <Pressable
          onPress={() => setLocationPickerVisible(true)}
          testID="inventory-counts-location"
          accessibilityRole="button"
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            backgroundColor: theme.colors.card,
          }}
        >
          <Text style={{ ...theme.typography.body, color: startLocationId ? theme.colors.text : theme.colors.textSecondary }}>
            {locations.find((location) => location.location_id === startLocationId)?.name ??
              t("counts.location", "Location")}
          </Text>
        </Pressable>
        <Select
          value={startLocationId}
          options={locations.map((location) => ({ label: location.name, value: location.location_id }))}
          onSelect={(value) => {
            setStartLocationId(value);
            setLocationPickerVisible(false);
          }}
          visible={locationPickerVisible}
          onClose={() => setLocationPickerVisible(false)}
          title={t("counts.location", "Location")}
        />
        <PrimaryButton onPress={() => void onStart()} disabled={!startLocationId || starting} accessibilityLabel="inventory-counts-start">
          {t("counts.start", "Start count")}
        </PrimaryButton>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.session_id}
        ItemSeparatorComponent={Separator}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={<EmptyState title={t("counts.empty", "No count sessions.")} />}
        renderItem={({ item }) => (
          <ListRow
            title={item.location_name ?? item.location_id}
            subtitle={item.created_at ? item.created_at.slice(0, 10) : undefined}
            rightContent={<Badge label={t(`counts.status.${item.status}`, item.status)} tone={countStatusTone(item.status)} />}
            onPress={() =>
              navigation.navigate("CountSession", { sessionId: item.session_id, locationName: item.location_name })
            }
            accessibilityLabel={`inventory-count-row-${item.session_id}`}
          />
        )}
      />
    </View>
  );
}
