import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, ScrollView, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { Card } from "../ui/components/Card";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { ErrorState, LoadingState } from "../ui/states";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { getAssetAudit, type AssetAudit } from "../api/assetAudits";
import { formatDateTime } from "../ui/formatters/dateTime";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "AuditSummary">;

export function AuditSummaryScreen({ navigation, route }: Props) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const { auditId } = route.params;
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
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

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await getAssetAudit(client, { apiKey, auditId, signal: controller.signal });
    if (controller.signal.aborted) return;
    if (!result.ok) {
      if (result.error.kind !== "canceled") logger.warn("Audit summary fetch failed", { error: result.error });
      return;
    }
    setAudit(result.data.data);
  }, [apiKey, auditId, client]);

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
  }, [apiKey, auditId, client]);

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
        action={<PrimaryButton onPress={() => void load()}>{t("common.retry", "Retry")}</PrimaryButton>}
      />
    );
  }

  const items = audit.items ?? [];
  const missing = items.filter((item) => item.result === "missing");
  const unexpected = items.filter((item) => item.result === "unexpected");

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("audit.summaryTitle", "Audit summary")}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
          {[audit.client_name, audit.location_name ?? t("audit.noLocation", "No location")]
            .filter(Boolean)
            .join(" • ")}
        </Text>
        {audit.completed_at ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
            {formatDateTime(audit.completed_at)}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
          <Count testID="audit-summary-present" label={t("audit.present", "Present")} value={audit.present_count} />
          <Count
            testID="audit-summary-missing"
            label={t("audit.missing", "Missing")}
            value={audit.missing_count}
            tone="danger"
          />
          <Count
            testID="audit-summary-unexpected"
            label={t("audit.unexpected", "Unexpected")}
            value={audit.unexpected_count}
            tone="warning"
          />
        </View>

        {missing.length > 0 ? (
          <>
            <Text
              style={{
                ...theme.typography.caption,
                color: theme.colors.textSecondary,
                fontWeight: "700",
                marginTop: theme.spacing.xl,
              }}
            >
              {t("audit.missing", "Missing")}
            </Text>
            <Card style={{ marginTop: theme.spacing.sm, padding: 0 }}>
              {missing.map((item, index) => (
                <View
                  key={item.asset_id}
                  testID={`audit-summary-missing-${item.asset_id}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: theme.spacing.md,
                    padding: theme.spacing.md,
                    borderBottomWidth: index === missing.length - 1 ? 0 : 1,
                    borderBottomColor: theme.colors.borderLight,
                  }}
                >
                  <MaterialCommunityIcons name="devices" size={20} color={theme.colors.danger} />
                  <View style={{ flex: 1 }}>
                    <Pressable
                      testID={`audit-summary-open-${item.asset_id}`}
                      onPress={() =>
                        navigation.navigate("AssetDetail", {
                          assetId: item.asset_id,
                          assetName: item.asset_name ?? undefined,
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={item.asset_name ?? item.asset_id}
                    >
                      <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                        {item.asset_name ?? item.asset_id}
                      </Text>
                      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
                        {[item.asset_tag, item.serial_number].filter(Boolean).join(" • ")}
                      </Text>
                    </Pressable>
                  </View>
                  <Pressable
                    testID={`audit-summary-create-ticket-${item.asset_id}`}
                    onPress={() => navigation.navigate("CreateTicket", {
                      clientId: item.client_id ?? audit.client_id,
                      clientName: audit.client_name ?? undefined,
                      assets: [{ asset_id: item.asset_id, name: item.asset_name ?? item.asset_id }],
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={t("audit.createTicket", "Create ticket")}
                    hitSlop={8}
                  >
                    <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "700" }}>
                      {t("audit.createTicket", "Create ticket")}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {unexpected.length > 0 ? (
          <>
            <Text
              style={{
                ...theme.typography.caption,
                color: theme.colors.textSecondary,
                fontWeight: "700",
                marginTop: theme.spacing.xl,
              }}
            >
              {t("audit.unexpected", "Unexpected")}
            </Text>
            <Card style={{ marginTop: theme.spacing.sm, padding: 0 }}>
              {unexpected.map((item, index) => (
                <View
                  key={item.asset_id}
                  testID={`audit-summary-unexpected-${item.asset_id}`}
                  style={{
                    padding: theme.spacing.md,
                    borderBottomWidth: index === unexpected.length - 1 ? 0 : 1,
                    borderBottomColor: theme.colors.borderLight,
                  }}
                >
                  <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
                    {item.asset_name ?? item.asset_id}
                  </Text>
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }} numberOfLines={1}>
                    {item.location ?? t("audit.noLocation", "No location")}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>

      <View style={{ padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
        <PrimaryButton
          testID="audit-summary-done"
          onPress={() => navigation.navigate("Tabs", { screen: "AssetsTab" } as never)}
        >
          {t("audit.done", "Done")}
        </PrimaryButton>
      </View>

    </View>
  );
}

function Count({
  label,
  value,
  tone,
  testID,
}: {
  label: string;
  value: number;
  tone?: "danger" | "warning";
  testID?: string;
}) {
  const theme = useTheme();
  const color =
    tone === "danger" ? theme.colors.danger : tone === "warning" ? theme.colors.warning : theme.colors.text;
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        padding: theme.spacing.md,
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
      }}
    >
      <Text style={{ ...theme.typography.title, color }}>{String(value)}</Text>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
    </View>
  );
}
