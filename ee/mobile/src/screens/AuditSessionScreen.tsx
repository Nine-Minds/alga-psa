import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Alert, Pressable, ScrollView, Text, View, Vibration } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Card } from "../ui/components/Card";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { SearchBar } from "../ui/components/SearchBar";
import { ErrorState, LoadingState } from "../ui/states";
import { useToast } from "../ui/toast/ToastProvider";
import { ProgressBar } from "../features/projects/components/ProgressBar";
import { AuditScanner } from "../features/assets/audit/AuditScanner";
import { RegisterAssetModal } from "../features/inventory/components/RegisterAssetModal";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import {
  auditSegments,
  completeAssetAudit,
  cancelAssetAudit,
  getAssetAudit,
  markAssetAuditItem,
  matchesAuditSearch,
  unmarkAssetAuditItem,
  type AssetAudit,
  type AssetAuditItem,
  type AuditSegment,
} from "../api/assetAudits";
import { lookupInventoryCode } from "../api/inventory";
import { useAppResume } from "../hooks/useAppResume";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "AuditSession">;

const SEGMENTS: AuditSegment[] = ["remaining", "present", "unexpected"];

const EMPTY_DEFAULTS: Record<AuditSegment, string> = {
  remaining: "Every expected device is accounted for.",
  present: "Nothing marked present yet.",
  unexpected: "No unexpected devices.",
};

export function AuditSessionScreen({ navigation, route }: Props) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const { showToast } = useToast();
  const { auditId } = route.params;
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const network = useNetworkStatus();
  const offline = isOfflineStatus(network);
  const abortRef = useRef<AbortController | null>(null);

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

  const [audit, setAudit] = useState<AssetAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<AuditSegment>("remaining");
  const [search, setSearch] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [registerCode, setRegisterCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await getAssetAudit(client, { apiKey, auditId, signal: controller.signal });
    if (controller.signal.aborted) return;
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("Audit fetch failed", { error: result.error });
      setError(t("audit.unableToLoad", "Unable to load the audit."));
      return;
    }
    setError(null);
    setAudit(result.data.data);
  }, [apiKey, auditId, client, t]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setLoading(true);
      await loadRef.current();
      if (!canceled) setLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [auditId, client, apiKey]);

  useAppResume(() => void loadRef.current());

  // An audit finished elsewhere (or before a restart) belongs on its summary.
  useEffect(() => {
    if (audit && audit.status !== "in_progress") {
      navigation.replace("AuditSummary", { auditId });
    }
  }, [audit, auditId, navigation]);

  const segments = useMemo(() => auditSegments(audit), [audit]);
  const presentCount = segments.present.length;
  const expectedTotal = presentCount + segments.remaining.length;

  const mark = useCallback(
    async (
      assetId: string,
      method: "scan" | "manual" | "register",
      result: "present" | "unexpected" = "present",
    ) => {
      if (!client || !apiKey || busy) return;
      if (offline) {
        showToast({ message: t("audit.offline", "You are offline; marks need a connection."), tone: "error" });
        return;
      }
      setBusy(true);
      const response = await markAssetAuditItem(client, { apiKey, auditId, assetId, method, result });
      setBusy(false);
      if (!response.ok) {
        logger.warn("Audit mark failed", { error: response.error });
        showToast({ message: t("audit.markFailed", "Unable to record that device."), tone: "error" });
        return;
      }
      const updated = response.data.data;
      setAudit(updated);
      // The server decides: a device that joined the scope after the snapshot
      // is stored present even when the scan asked for unexpected, so the
      // confirmation has to read the stored row, not the request.
      const recorded = updated.items?.find((item) => item.asset_id === assetId)?.result ?? result;
      // Same short buzz the Inventory scanner gives on a successful resolve.
      Vibration.vibrate(30);
      showToast({
        message:
          recorded === "unexpected"
            ? t("audit.markedUnexpected", "Recorded as unexpected")
            : t("audit.markedPresent", "Marked present"),
        tone: "success",
      });
    },
    [apiKey, auditId, busy, client, offline, showToast, t],
  );

  const unmark = useCallback(
    async (assetId: string) => {
      if (!client || !apiKey || busy) return;
      if (offline) {
        showToast({ message: t("audit.offline", "You are offline; marks need a connection."), tone: "error" });
        return;
      }
      setBusy(true);
      const response = await unmarkAssetAuditItem(client, { apiKey, auditId, assetId });
      setBusy(false);
      if (!response.ok) {
        showToast({ message: t("audit.markFailed", "Unable to record that device."), tone: "error" });
        return;
      }
      setAudit(response.data.data);
    },
    [apiKey, auditId, busy, client, offline, showToast, t],
  );

  const resolveCode = useCallback(
    async (code: string) => {
      if (!client || !apiKey) return;
      if (offline) {
        showToast({ message: t("audit.offline", "You are offline; marks need a connection."), tone: "error" });
        return;
      }
      setScanBusy(true);
      setScanError(null);
      const response = await lookupInventoryCode(client, { apiKey, code });
      setScanBusy(false);

      if (!response.ok) {
        setScanError(t("audit.lookupFailed", "Lookup failed. Try again."));
        return;
      }

      const result = response.data.data;
      if (result.type === "none") {
        setScannerOpen(false);
        setRegisterCode(code);
        return;
      }
      if (result.type !== "asset") {
        showToast({ message: t("audit.notAnAsset", "That code is not a device."), tone: "error" });
        return;
      }

      const assetId = result.asset.asset_id;
      // A device already recorded — present or unexpected — is only confirmed
      // back to the technician; the server never promotes an unexpected one.
      const already =
        segments.present.find((item) => item.asset_id === assetId) ??
        segments.unexpected.find((item) => item.asset_id === assetId);
      if (already) {
        showToast({
          message:
            already.result === "unexpected"
              ? t("audit.alreadyUnexpected", "Already recorded as unexpected")
              : t("audit.alreadyPresent", "Already marked present"),
          tone: "info",
        });
        return;
      }
      const inScope = segments.remaining.some((item) => item.asset_id === assetId);
      await mark(assetId, "scan", inScope ? "present" : "unexpected");
    },
    [apiKey, client, mark, offline, segments.present, segments.remaining, segments.unexpected, showToast, t],
  );

  const finish = useCallback(async () => {
    if (!client || !apiKey) return;
    const complete = async () => {
      setBusy(true);
      const response = await completeAssetAudit(client, { apiKey, auditId });
      setBusy(false);
      if (!response.ok) {
        showToast({ message: t("audit.completeFailed", "Unable to finish the audit."), tone: "error" });
        return;
      }
      navigation.replace("AuditSummary", { auditId });
    };

    if (segments.remaining.length === 0) {
      await complete();
      return;
    }
    Alert.alert(
      t("audit.finishTitle", "Finish the audit?"),
      t("audit.finishBody", "{{count}} devices are still unmarked; they will be recorded as missing.", {
        count: segments.remaining.length,
      }),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        { text: t("audit.finish", "Finish"), onPress: () => void complete() },
      ],
    );
  }, [apiKey, auditId, client, navigation, segments.remaining.length, showToast, t]);

  const cancel = useCallback(() => {
    if (!client || !apiKey) return;
    Alert.alert(
      t("audit.cancelTitle", "Cancel the audit?"),
      t("audit.cancelBody", "Nothing is recorded against the devices."),
      [
        { text: t("audit.keepGoing", "Keep going"), style: "cancel" },
        {
          text: t("audit.cancelAudit", "Cancel audit"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              const response = await cancelAssetAudit(client, { apiKey, auditId });
              if (!response.ok) {
                showToast({ message: t("audit.cancelFailed", "Unable to cancel the audit."), tone: "error" });
                return;
              }
              navigation.goBack();
            })();
          },
        },
      ],
    );
  }, [apiKey, auditId, client, navigation, showToast, t]);

  if (!config.ok) {
    return <ErrorState title={t("errors.configuration", "Configuration error")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("errors.signedOut", "Signed out")} />;
  }
  if (loading && !audit) {
    return <LoadingState message={t("audit.loading", "Loading the audit")} />;
  }
  if (!audit) {
    return (
      <ErrorState
        title={t("audit.unableToLoad", "Unable to load the audit.")}
        description={error ?? undefined}
        action={<PrimaryButton onPress={() => void load()}>{t("common.retry", "Retry")}</PrimaryButton>}
      />
    );
  }

  const visibleItems = segments[segment].filter((item) => matchesAuditSearch(item, search));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1, fontWeight: "600" }}>
            {t("audit.progress", "{{present}} of {{total}} present", {
              present: presentCount,
              total: expectedTotal,
            })}
          </Text>
          <Pressable
            testID="audit-session-cancel"
            onPress={cancel}
            accessibilityRole="button"
            accessibilityLabel={t("audit.cancelAudit", "Cancel audit")}
            hitSlop={8}
          >
            <Feather name="x-circle" size={20} color={theme.colors.textSecondary} />
          </Pressable>
        </View>
        <View style={{ marginTop: theme.spacing.sm }}>
          <ProgressBar
            testID="audit-session-progress"
            ratio={expectedTotal === 0 ? 0 : presentCount / expectedTotal}
          />
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton testID="audit-session-scan" onPress={() => setScannerOpen(true)}>
              {t("audit.scan", "Scan")}
            </PrimaryButton>
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton testID="audit-session-finish" onPress={() => void finish()} disabled={busy}>
              {t("audit.finish", "Finish")}
            </PrimaryButton>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: theme.spacing.sm, padding: theme.spacing.lg, paddingBottom: 0 }}>
        {SEGMENTS.map((key) => {
          const selected = segment === key;
          const label = t(`audit.segments.${key}`, key);
          return (
            <Pressable
              key={key}
              testID={`audit-session-segment-${key}`}
              onPress={() => setSegment(key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              style={{
                flex: 1,
                paddingVertical: theme.spacing.sm,
                alignItems: "center",
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
                {`${label} ${segments[key].length}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder={t("audit.searchPlaceholder", "Search by name, tag or serial")}
          accessibilityLabel={t("audit.searchPlaceholder", "Search by name, tag or serial")}
        />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        <Card style={{ padding: visibleItems.length === 0 ? theme.spacing.md : 0 }}>
          {visibleItems.length === 0 ? (
            <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
              {t(`audit.empty.${segment}`, EMPTY_DEFAULTS[segment])}
            </Text>
          ) : (
            visibleItems.map((item, index) => (
              <AuditRow
                key={item.asset_id}
                item={item}
                last={index === visibleItems.length - 1}
                actionLabel={
                  segment === "remaining"
                    ? t("audit.markPresent", "Mark present")
                    : segment === "present"
                      ? t("audit.unmark", "Unmark")
                      : null
                }
                onAction={
                  segment === "remaining"
                    ? () => void mark(item.asset_id, "manual")
                    : segment === "present"
                      ? () => void unmark(item.asset_id)
                      : undefined
                }
                busy={busy}
              />
            ))
          )}
        </Card>
      </ScrollView>

      <AuditScanner
        visible={scannerOpen}
        busy={scanBusy}
        error={scanError}
        onScan={(code) => void resolveCode(code)}
        onClose={() => {
          setScannerOpen(false);
          setScanError(null);
        }}
      />
      {registerCode ? (
        <RegisterAssetModal
          visible
          client={client}
          apiKey={apiKey ?? null}
          code={registerCode}
          clientId={audit.client_id}
          clientName={audit.client_name ?? null}
          locationId={audit.location_id}
          locationName={audit.location_name ?? null}
          onClose={() => setRegisterCode(null)}
          onCreated={(assetId) => {
            setRegisterCode(null);
            // Created inside the audit's scope, so the server counts it present.
            void mark(assetId, "register");
          }}
        />
      ) : null}
    </View>
  );
}

function AuditRow({
  item,
  actionLabel,
  onAction,
  busy,
  last,
}: {
  item: AssetAuditItem;
  actionLabel: string | null;
  onAction?: () => void;
  busy: boolean;
  last: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      testID={`audit-item-${item.asset_id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.borderLight,
      }}
    >
      <MaterialCommunityIcons name="devices" size={20} color={theme.colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
          {item.asset_name ?? item.asset_id}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
          {[item.asset_tag, item.serial_number, item.location].filter(Boolean).join(" • ")}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          testID={`audit-item-action-${item.asset_id}`}
          onPress={onAction}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
        >
          <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
