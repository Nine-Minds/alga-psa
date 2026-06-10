import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CommonActions } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { Avatar } from "../ui/components/Avatar";
import { Badge } from "../ui/components/Badge";
import { Card } from "../ui/components/Card";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { getClient, getClientLocations, type ClientDetail, type ClientLocation } from "../api/clients";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "ClientDetail">;

function websiteUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function locationLine(location: ClientLocation): string {
  return [
    location.address_line1,
    location.address_line2,
    [location.city, location.state_province, location.postal_code].filter(Boolean).join(", "),
    location.country_name,
  ]
    .filter(Boolean)
    .join("\n");
}

export function ClientDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation("clients");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const abortRef = useRef<AbortController | null>(null);
  const { clientId, clientName } = route.params;

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/clients",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [locations, setLocations] = useState<ClientLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    if (!client || !session) return;
    setError(null);

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    const [detailResult, locationsResult] = await Promise.all([
      getClient(client, { apiKey: session.accessToken, clientId, signal: abortController.signal }),
      getClientLocations(client, { apiKey: session.accessToken, clientId, signal: abortController.signal }),
    ]);
    if (abortController.signal.aborted) return;

    if (!detailResult.ok) {
      if (detailResult.error.kind === "canceled") return;
      logger.warn("Client detail fetch failed", { error: detailResult.error });
      setError(t("detail.unableToLoadDescription"));
      return;
    }
    setDetail(detailResult.data.data);
    setLocations(locationsResult.ok && Array.isArray(locationsResult.data.data) ? locationsResult.data.data : []);
  }, [client, clientId, session, t]);

  const { refreshing, refresh } = usePullToRefresh(load, { haptics: true });

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      setLoading(true);
      await load();
      if (!canceled) setLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, load, session]);

  const onViewTickets = useCallback(() => {
    navigation.dispatch(
      CommonActions.navigate("Tabs", {
        screen: "TicketsTab",
        params: {
          screen: "TicketsList",
          params: { clientId, clientName: detail?.client_name ?? clientName },
        },
      }),
    );
  }, [clientId, clientName, detail?.client_name, navigation]);

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }

  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }

  if (loading && !detail) {
    return <LoadingState message={t("detail.loading")} />;
  }

  if (error && !detail) {
    return (
      <ErrorState
        title={t("detail.unableToLoad")}
        description={error}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  }

  if (!detail) {
    return <ErrorState title={t("detail.unableToLoad")} description={t("detail.unableToLoadDescription")} />;
  }

  const logoUri = detail.logoUrl ? `${config.baseUrl}${detail.logoUrl}` : null;

  const allDetailRows: { icon: keyof typeof Feather.glyphMap; label: string; value?: string | null; onPress?: () => void }[] = [
    {
      icon: "phone",
      label: t("detail.phone"),
      value: detail.phone_no,
      onPress: detail.phone_no ? () => void Linking.openURL(`tel:${detail.phone_no}`) : undefined,
    },
    {
      icon: "mail",
      label: t("detail.email"),
      value: detail.email,
      onPress: detail.email ? () => void Linking.openURL(`mailto:${detail.email}`) : undefined,
    },
    {
      icon: "globe",
      label: t("detail.website"),
      value: detail.url,
      onPress: detail.url ? () => void Linking.openURL(websiteUrl(detail.url ?? "")) : undefined,
    },
    { icon: "map-pin", label: t("detail.address"), value: detail.address },
    { icon: "user", label: t("detail.accountManager"), value: detail.account_manager_full_name },
  ];
  const detailRows = allDetailRows.filter((row) => Boolean(row.value));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Avatar name={detail.client_name} imageUri={logoUri} authToken={session.accessToken} size="lg" />
        <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
          <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{detail.client_name}</Text>
          {detail.client_type ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
              {detail.client_type}
            </Text>
          ) : null}
        </View>
        {detail.is_inactive ? <Badge label={t("detail.inactive")} tone="warning" /> : null}
      </View>

      <View style={{ marginTop: theme.spacing.lg }}>
        <PrimaryButton onPress={onViewTickets}>{t("detail.viewTickets")}</PrimaryButton>
      </View>

      {detailRows.length > 0 ? (
        <Card style={{ marginTop: theme.spacing.lg, padding: 0 }}>
          {detailRows.map((row, index) => (
            <DetailRow
              key={row.label}
              theme={theme}
              icon={row.icon}
              label={row.label}
              value={row.value}
              onPress={row.onPress}
              isLast={index === detailRows.length - 1}
            />
          ))}
        </Card>
      ) : null}

      {locations.length > 0 ? (
        <>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
            {t("detail.locations")}
          </Text>
          <Card style={{ marginTop: theme.spacing.sm, padding: 0 }}>
            {locations.map((location, index) => (
              <View
                key={location.location_id}
                style={{
                  padding: theme.spacing.md,
                  borderBottomWidth: index === locations.length - 1 ? 0 : 1,
                  borderBottomColor: theme.colors.borderLight,
                }}
              >
                <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
                  {location.location_name || t("detail.locationFallback")}
                  {location.is_default ? ` • ${t("detail.defaultLocation")}` : ""}
                </Text>
                <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                  {locationLine(location)}
                </Text>
                {location.phone ? (
                  <Pressable
                    onPress={() => void Linking.openURL(`tel:${location.phone}`)}
                    accessibilityRole="button"
                    accessibilityLabel={t("detail.phone")}
                    hitSlop={4}
                  >
                    <Text style={{ ...theme.typography.caption, color: theme.colors.primary, marginTop: theme.spacing.xs }}>
                      {location.phone}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

function DetailRow({
  theme,
  icon,
  label,
  value,
  onPress,
  isLast = false,
}: {
  theme: Theme;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value?: string | null;
  onPress?: () => void;
  isLast?: boolean;
}) {
  if (!value) return null;
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: theme.spacing.md,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.colors.borderLight,
      }}
    >
      <Feather name={icon} size={16} color={theme.colors.textSecondary} />
      <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
        <Text style={{ ...theme.typography.body, color: onPress ? theme.colors.primary : theme.colors.text, marginTop: 2 }}>
          {value}
        </Text>
      </View>
      {onPress ? <Feather name="external-link" size={16} color={theme.colors.textSecondary} /> : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}
