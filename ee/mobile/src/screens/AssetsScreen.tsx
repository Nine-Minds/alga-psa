import type { CompositeScreenProps } from "@react-navigation/native";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { Badge } from "../ui/components/Badge";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { SecondaryButton } from "../features/opportunities/components/SecondaryButton";
import { SearchBar } from "../ui/components/SearchBar";
import { EntityPickerModal, type EntityPickerItem } from "../ui/components/EntityPickerModal";
import { ScanView } from "../features/inventory/components/ScanView";
import type { DrawerParamList, RootStackParamList } from "../navigation/types";
import { useAppResume } from "../hooks/useAppResume";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { useCapabilities } from "../capabilities/CapabilitiesContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient, type ApiClient } from "../api";
import {
  assetStatusLabel,
  listAssetStatuses,
  listAssets,
  type AssetListItem,
  type AssetStatusKind,
  type AssetStatusOption,
} from "../api/assets";
import { listAssetAudits, type AssetAudit } from "../api/assetAudits";
import { collectFilteredPage } from "../api/narrowedPaging";
import { listClients, type ClientListItem } from "../api/clients";
import { listClientLocations, type LocationListItem } from "../api/referenceData";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useTheme } from "../ui/ThemeContext";
import { formatDateShort } from "../ui/formatters/dateTime";
import { logger } from "../logging/logger";

type Props = CompositeScreenProps<
  DrawerScreenProps<DrawerParamList, "AssetsTab">,
  NativeStackScreenProps<RootStackParamList>
>;

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;

const KIND_ORDER: AssetStatusKind[] = ["deployable", "pending", "undeployable", "archived"];

const TYPE_ICONS: Record<string, string> = {
  workstation: "desktop-tower-monitor",
  server: "server",
  network_device: "router-network",
  mobile_device: "cellphone",
  printer: "printer",
};

export type AssetListFilters = {
  clientId: string | null;
  clientName: string | null;
  locationId: string | null;
  locationName: string | null;
  /** Status slugs; empty means "every non-archived status". */
  statuses: string[];
  assetType: string | null;
};

export const DEFAULT_ASSET_FILTERS: AssetListFilters = {
  clientId: null,
  clientName: null,
  locationId: null,
  locationName: null,
  statuses: [],
  assetType: null,
};

/** The audit-relevant default: everything the registry does not call archived. */
export function defaultStatusSlugs(statuses: AssetStatusOption[]): string[] {
  return statuses.filter((status) => status.kind !== "archived").map((status) => status.slug);
}

export function activeAssetFilterCount(filters: AssetListFilters, statuses: AssetStatusOption[]): number {
  let count = 0;
  if (filters.clientId) count += 1;
  if (filters.locationId) count += 1;
  if (filters.assetType) count += 1;
  const selected = filters.statuses.length > 0 ? filters.statuses : defaultStatusSlugs(statuses);
  if ([...selected].sort().join(",") !== [...defaultStatusSlugs(statuses)].sort().join(",")) count += 1;
  return count;
}

export function AssetsScreen({ navigation }: Props) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const { features } = useCapabilities();
  const network = useNetworkStatus();
  const offline = isOfflineStatus(network);
  const abortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/assets",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const apiKey = session?.accessToken;

  const [items, setItems] = useState<AssetListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [hasNext, setHasNext] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<AssetListFilters>(DEFAULT_ASSET_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statuses, setStatuses] = useState<AssetStatusOption[]>([]);
  const [statusesLoaded, setStatusesLoaded] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [recentAudits, setRecentAudits] = useState<AssetAudit[]>([]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (!client || !apiKey) return;
    let canceled = false;
    void (async () => {
      const result = await listAssetStatuses(client, { apiKey });
      if (canceled) return;
      if (result.ok) setStatuses(result.data.data ?? []);
      setStatusesLoaded(true);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client]);

  // Recent audits sit above the list so a finished walk is one tap away.
  useEffect(() => {
    if (!client || !apiKey || !features.assetAudit) return;
    let canceled = false;
    void (async () => {
      const result = await listAssetAudits(client, { apiKey, page: 1, limit: 10 });
      if (canceled || !result.ok) return;
      setRecentAudits(result.data.data ?? []);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, features.assetAudit]);

  const selectedStatuses = useMemo(
    () => (filters.statuses.length > 0 ? filters.statuses : defaultStatusSlugs(statuses)),
    [filters.statuses, statuses],
  );

  const queryKey = useMemo(
    () =>
      `${search}|${filters.clientId ?? "-"}|${filters.locationId ?? "-"}|${filters.assetType ?? "-"}|${[
        ...selectedStatuses,
      ]
        .sort()
        .join(",")}`,
    [filters.assetType, filters.clientId, filters.locationId, search, selectedStatuses],
  );

  const loadPage = useCallback(
    async ({ pageToLoad, replace }: { pageToLoad: number; replace: boolean }) => {
      if (!client || !apiKey || !statusesLoaded) return;
      setError(null);
      setNoAccess(false);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // The v1 list takes one status slug; a multi-select asks the server for
      // nothing and narrows on the device, so the page is filled from as many
      // server pages as it takes.
      const singleStatus = selectedStatuses.length === 1 ? selectedStatuses[0] : undefined;
      const selected = new Set(selectedStatuses);
      const narrowing = !singleStatus && selected.size > 0;

      const collected = await collectFilteredPage<AssetListItem>({
        startPage: pageToLoad,
        keep: narrowing ? (asset) => selected.has(asset.status) : undefined,
        loadPage: async (page) => {
          const result = await listAssets(client, {
            apiKey,
            page,
            limit: PAGE_SIZE,
            search: search || undefined,
            client_id: filters.clientId ?? undefined,
            location_id: filters.locationId ?? undefined,
            status: singleStatus,
            asset_type: filters.assetType ?? undefined,
            signal: controller.signal,
          });

          if (controller.signal.aborted) return null;
          if (!result.ok) {
            if (result.error.kind === "canceled") return null;
            logger.warn("Asset list fetch failed", { error: result.error });
            if (result.error.kind === "permission") {
              setItems([]);
              setHasNext(false);
              setNoAccess(true);
              return null;
            }
            setError(t("list.unableToLoad", "Unable to load."));
            return null;
          }

          const pagination = result.data.pagination;
          return {
            items: result.data.data,
            page: pagination.page,
            hasNext: pagination.page * pagination.limit < pagination.total,
            total: pagination.total,
          };
        },
      });

      if (abortRef.current === controller) abortRef.current = null;
      if (!collected || controller.signal.aborted) return;

      setItems((current) => (replace ? collected.items : [...current, ...collected.items]));
      setPage(collected.page);
      setTotal(collected.total);
      setHasNext(collected.hasNext);
    },
    [apiKey, client, filters.assetType, filters.clientId, filters.locationId, search, selectedStatuses, statusesLoaded, t],
  );

  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;

  const { refreshing, refresh } = usePullToRefresh(
    async () => {
      await loadPageRef.current({ pageToLoad: 1, replace: true });
    },
    { haptics: true },
  );
  useAppResume(() => void refresh());

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setInitialLoading(true);
      await loadPageRef.current({ pageToLoad: 1, replace: true });
      if (!canceled) setInitialLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [queryKey, statusesLoaded]);

  const onEndReached = useCallback(async () => {
    if (initialLoading || refreshing || loadingMoreRef.current || !hasNext) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPageRef.current({ pageToLoad: page + 1, replace: false });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasNext, initialLoading, page, refreshing]);

  const openScan = useCallback(() => {
    if (features.inventory) {
      navigation.navigate("InventoryTab", { segment: "scan" });
      return;
    }
    setScanOpen(true);
  }, [features.inventory, navigation]);

  const keyExtractor = useCallback((item: AssetListItem) => item.asset_id, []);
  const renderItem = useCallback(
    ({ item }: { item: AssetListItem }) => (
      <AssetRow
        item={item}
        statusLabel={assetStatusLabel(item.status, statuses)}
        onOpen={() => navigation.navigate("AssetDetail", { assetId: item.asset_id, assetName: item.name })}
      />
    ),
    [navigation, statuses],
  );

  const filterCount = activeAssetFilterCount(filters, statuses);

  const header = (
    <View style={{ marginBottom: theme.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <SearchBar
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder={t("list.searchPlaceholder", "Search devices")}
            accessibilityLabel={t("list.searchPlaceholder", "Search devices")}
          />
        </View>
        <Pressable
          testID="assets-filters"
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("list.filters", "Filters")}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: filterCount > 0 ? theme.colors.primary : theme.colors.border,
            backgroundColor: theme.colors.card,
            opacity: pressed ? 0.95 : 1,
          })}
        >
          <Feather name="filter" size={16} color={filterCount > 0 ? theme.colors.primary : theme.colors.textSecondary} />
          {filterCount > 0 ? (
            <Text testID="assets-filter-count" style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
              {filterCount}
            </Text>
          ) : null}
        </Pressable>
      </View>
      {total != null ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
          {t("list.count", "{{count}} devices", { count: total })}
        </Text>
      ) : null}
      {recentAudits.length > 0 ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: "700" }}>
            {t("audit.recent", "Recent audits")}
          </Text>
          {recentAudits.map((item) => (
            <Pressable
              key={item.audit_id}
              testID={`assets-recent-audits-${item.audit_id}`}
              onPress={() => navigation.navigate("AuditSummary", { auditId: item.audit_id })}
              accessibilityRole="button"
              accessibilityLabel={t("audit.recent", "Recent audits")}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: theme.spacing.sm,
                padding: theme.spacing.md,
                borderRadius: theme.borderRadius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.card,
                opacity: pressed ? 0.95 : 1,
              })}
            >
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {formatDateShort(item.started_at)}
              </Text>
              <Text style={{ ...theme.typography.caption, color: theme.colors.text }}>
                {t("audit.recentCounts", "{{present}} present · {{missing}} missing", {
                  present: item.present_count,
                  missing: item.missing_count,
                })}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  if (!config.ok) {
    return <ErrorState title={t("errors.configuration", "Configuration error")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("errors.signedOut", "Signed out")} />;
  }
  if (noAccess) {
    return <ErrorState title={t("list.noAccess", "You don't have access to assets.")} />;
  }
  if (initialLoading && items.length === 0) {
    return <LoadingState message={t("list.loading", "Loading devices")} />;
  }
  if (error && items.length === 0) {
    return (
      <ErrorState
        title={t("list.unableToLoad", "Unable to load.")}
        description={offline ? t("list.offline", "You are offline.") : undefined}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common.retry", "Retry")}</PrimaryButton>}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
        }}
      >
        {features.assetAudit ? (
          <Pressable
            testID="assets-audit"
            onPress={() => navigation.navigate("AuditSetup")}
            accessibilityRole="button"
            accessibilityLabel={t("list.audit", "Audit")}
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
          >
            <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={theme.colors.primary} />
            <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
              {t("list.audit", "Audit")}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="assets-scan"
          onPress={openScan}
          accessibilityRole="button"
          accessibilityLabel={t("list.scan", "Scan")}
          hitSlop={8}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
        >
          <MaterialCommunityIcons name="barcode-scan" size={18} color={theme.colors.primary} />
          <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
            {t("list.scan", "Scan")}
          </Text>
        </Pressable>
      </View>
      <FlatList
        testID="assets-list"
        data={items}
        keyExtractor={keyExtractor}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={{ padding: theme.spacing.lg, flexGrow: 1 }}
        onEndReached={() => void onEndReached()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={header}
        renderItem={renderItem}
        ListEmptyComponent={
          <EmptyState
            title={t("list.empty", "No devices match")}
            action={
              filterCount > 0 ? (
                <PrimaryButton testID="assets-clear-filters" onPress={() => setFilters(DEFAULT_ASSET_FILTERS)}>
                  {t("list.clearFilters", "Clear filters")}
                </PrimaryButton>
              ) : undefined
            }
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: theme.spacing.lg, alignItems: "center" }}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : null
        }
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
      <AssetFiltersSheet
        visible={filtersOpen}
        filters={{ ...filters, statuses: selectedStatuses }}
        statuses={statuses}
        client={client}
        apiKey={apiKey}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
      />
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              padding: theme.spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable
              testID="assets-scan-close"
              onPress={() => setScanOpen(false)}
              accessibilityRole="button"
              accessibilityLabel={t("common.cancel", "Cancel")}
              hitSlop={8}
            >
              <Feather name="x" size={22} color={theme.colors.text} />
            </Pressable>
          </View>
          <ScanView />
        </View>
      </Modal>
    </View>
  );
}

const AssetRow = memo(function AssetRow({
  item,
  statusLabel,
  onOpen,
}: {
  item: AssetListItem;
  statusLabel: string;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const icon = (item.asset_type && TYPE_ICONS[item.asset_type]) ?? "devices";

  return (
    <Pressable
      testID={`asset-row-${item.asset_id}`}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={item.name}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.96 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon as never} size={22} color={theme.colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
          {[item.asset_tag, item.client_name, item.location].filter(Boolean).join(" • ")}
        </Text>
      </View>
      {statusLabel ? <Badge label={statusLabel} tone="info" /> : null}
    </Pressable>
  );
});

function AssetFiltersSheet({
  visible,
  filters,
  statuses,
  client,
  apiKey,
  onClose,
  onApply,
}: {
  visible: boolean;
  filters: AssetListFilters;
  statuses: AssetStatusOption[];
  client: ApiClient | null;
  apiKey?: string;
  onClose: () => void;
  onApply: (filters: AssetListFilters) => void;
}) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const [draft, setDraft] = useState<AssetListFilters>(filters);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationListItem[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [filters, visible]);

  const loadClients = useCallback(
    async (search?: string) => {
      if (!client || !apiKey) return;
      setClientsLoading(true);
      setClientsError(null);
      const result = await listClients(client, { apiKey, page: 1, limit: 50, search: search || undefined });
      setClientsLoading(false);
      if (!result.ok) {
        setClientsError(t("list.unableToLoadClients", "Unable to load clients."));
        return;
      }
      setClients(result.data.data);
    },
    [apiKey, client, t],
  );

  const loadLocations = useCallback(
    async (clientId: string) => {
      if (!client || !apiKey) return;
      setLocationsLoading(true);
      const result = await listClientLocations(client, { apiKey, clientId });
      setLocationsLoading(false);
      setLocations(result.ok ? result.data.data ?? [] : []);
    },
    [apiKey, client],
  );

  const statusesByKind = useMemo(() => {
    const grouped = new Map<AssetStatusKind, AssetStatusOption[]>();
    for (const kind of KIND_ORDER) grouped.set(kind, []);
    for (const status of statuses) {
      grouped.get(status.kind)?.push(status);
    }
    return KIND_ORDER.map((kind) => ({ kind, statuses: grouped.get(kind) ?? [] })).filter(
      (group) => group.statuses.length > 0,
    );
  }, [statuses]);

  const assetTypes = useMemo(() => Object.keys(TYPE_ICONS), []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="assets-filter-sheet">
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: theme.spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
            {t("list.filterTitle", "Filter devices")}
          </Text>
          <Pressable
            testID="assets-filter-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel", "Cancel")}
            hitSlop={8}
          >
            <Feather name="x" size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
          <FilterRow
            testID="assets-filter-client"
            label={t("list.client", "Client")}
            value={draft.clientName ?? t("list.anyClient", "Any client")}
            onPress={() => {
              setClientPickerOpen(true);
              void loadClients();
            }}
            onClear={
              draft.clientId
                ? () =>
                    setDraft((current) => ({
                      ...current,
                      clientId: null,
                      clientName: null,
                      locationId: null,
                      locationName: null,
                    }))
                : undefined
            }
          />
          <FilterRow
            testID="assets-filter-location"
            label={t("list.location", "Location")}
            value={draft.locationName ?? t("list.anyLocation", "Any location")}
            disabled={!draft.clientId}
            onPress={() => {
              if (!draft.clientId) return;
              setLocationPickerOpen(true);
              void loadLocations(draft.clientId);
            }}
            onClear={
              draft.locationId
                ? () => setDraft((current) => ({ ...current, locationId: null, locationName: null }))
                : undefined
            }
          />

          <Text
            style={{
              ...theme.typography.caption,
              color: theme.colors.textSecondary,
              fontWeight: "700",
              marginTop: theme.spacing.lg,
            }}
          >
            {t("list.status", "Status")}
          </Text>
          {statusesByKind.map((group) => (
            <View key={group.kind} style={{ marginTop: theme.spacing.sm }}>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
                {t(`list.statusKind.${group.kind}`, group.kind)}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: 4 }}>
                {group.statuses.map((status) => {
                  const selected = draft.statuses.includes(status.slug);
                  return (
                    <Pressable
                      key={status.slug}
                      testID={`assets-filter-status-${status.slug}`}
                      onPress={() =>
                        setDraft((current) => ({
                          ...current,
                          statuses: selected
                            ? current.statuses.filter((slug) => slug !== status.slug)
                            : [...current.statuses, status.slug],
                        }))
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

          <View style={{ height: theme.spacing.lg }} />
          <FilterRow
            testID="assets-filter-type"
            label={t("list.type", "Type")}
            value={
              draft.assetType
                ? t(`list.assetType.${draft.assetType}`, draft.assetType)
                : t("list.anyType", "Any type")
            }
            onPress={() => setTypePickerOpen(true)}
            onClear={draft.assetType ? () => setDraft((current) => ({ ...current, assetType: null })) : undefined}
          />
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <SecondaryButton
              testID="assets-filter-reset"
              onPress={() => setDraft({ ...DEFAULT_ASSET_FILTERS, statuses: defaultStatusSlugs(statuses) })}
            >
              {t("list.reset", "Reset")}
            </SecondaryButton>
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton testID="assets-filter-apply" onPress={() => onApply(draft)}>
              {t("list.apply", "Apply")}
            </PrimaryButton>
          </View>
        </View>
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
        error={clientsError}
        selectedId={draft.clientId}
        authToken={apiKey}
        onSearch={(value) => void loadClients(value)}
        onSelect={(id, label) => {
          setDraft((current) => ({
            ...current,
            clientId: id,
            clientName: label,
            locationId: null,
            locationName: null,
          }));
          setClientPickerOpen(false);
        }}
        onClose={() => setClientPickerOpen(false)}
      />
      <EntityPickerModal
        visible={locationPickerOpen}
        title={t("list.selectLocation", "Select a location")}
        items={locations.map<EntityPickerItem>((location) => ({
          id: location.location_id,
          label: location.location_name ?? location.address_line1 ?? location.location_id,
          subtitle: location.city ?? null,
        }))}
        loading={locationsLoading}
        error={null}
        selectedId={draft.locationId}
        onSelect={(id, label) => {
          setDraft((current) => ({ ...current, locationId: id, locationName: label }));
          setLocationPickerOpen(false);
        }}
        onClose={() => setLocationPickerOpen(false)}
      />
      <EntityPickerModal
        visible={typePickerOpen}
        title={t("list.selectType", "Select a type")}
        items={assetTypes.map<EntityPickerItem>((type) => ({ id: type, label: t(`list.assetType.${type}`, type) }))}
        loading={false}
        error={null}
        searchable={false}
        selectedId={draft.assetType}
        onSelect={(id) => {
          setDraft((current) => ({ ...current, assetType: id }));
          setTypePickerOpen(false);
        }}
        onClose={() => setTypePickerOpen(false)}
      />
    </Modal>
  );
}

function FilterRow({
  label,
  value,
  onPress,
  onClear,
  disabled,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  onClear?: () => void;
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
      {onClear ? (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
        >
          <Feather name="x" size={16} color={theme.colors.textSecondary} />
        </Pressable>
      ) : (
        <Feather name="chevron-right" size={18} color={theme.colors.textSecondary} />
      )}
    </Pressable>
  );
}
