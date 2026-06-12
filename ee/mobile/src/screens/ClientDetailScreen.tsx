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
import {
  getClient,
  getClientContacts,
  getClientLocations,
  updateClient,
  type ClientDetail,
  type ClientLocation,
} from "../api/clients";
import { buildContactAvatarUri, getContactReachLine, type ContactListItem } from "../api/contacts";
import { getClientMetadataHeaders } from "../device/clientMetadata";
import { AccountManagerPickerModal } from "../features/clients/components/AccountManagerPickerModal";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "ClientDetail">;

const CONTACTS_PAGE_SIZE = 20;

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
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsVisible, setContactsVisible] = useState(false);
  const [contactsPage, setContactsPage] = useState(1);
  const [contactsLoadingMore, setContactsLoadingMore] = useState(false);
  const [managerPickerOpen, setManagerPickerOpen] = useState(false);
  const [managerUpdating, setManagerUpdating] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
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

    const [detailResult, locationsResult, contactsResult] = await Promise.all([
      getClient(client, { apiKey: session.accessToken, clientId, signal: abortController.signal }),
      getClientLocations(client, { apiKey: session.accessToken, clientId, signal: abortController.signal }),
      getClientContacts(client, {
        apiKey: session.accessToken,
        clientId,
        page: 1,
        limit: CONTACTS_PAGE_SIZE,
        signal: abortController.signal,
      }),
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

    if (contactsResult.ok && Array.isArray(contactsResult.data.data)) {
      setContacts(contactsResult.data.data);
      setContactsTotal(contactsResult.data.pagination?.total ?? contactsResult.data.data.length);
      setContactsPage(1);
      setContactsVisible(true);
    } else {
      setContacts([]);
      setContactsTotal(0);
      setContactsVisible(false);
      if (!contactsResult.ok && contactsResult.error.kind !== "canceled" && contactsResult.error.kind !== "permission") {
        logger.warn("Client contacts fetch failed", { error: contactsResult.error });
      }
    }
  }, [client, clientId, session, t]);

  const { refreshing, refresh } = usePullToRefresh(load, { haptics: true });

  useEffect(() => {
    if (detail?.client_name && detail.client_name !== clientName) {
      navigation.setParams({ clientName: detail.client_name });
    }
  }, [clientName, detail?.client_name, navigation]);

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

  const openManagerPicker = useCallback(() => {
    setManagerError(null);
    setManagerPickerOpen(true);
  }, []);

  const onSelectManager = useCallback(
    async (userId: string, displayName: string) => {
      if (!client || !session || !detail || managerUpdating) return;
      setManagerError(null);
      setManagerUpdating(true);
      const previous = detail;
      setDetail({ ...detail, account_manager_id: userId, account_manager_full_name: displayName });
      try {
        const auditHeaders = await getClientMetadataHeaders();
        const result = await updateClient(client, {
          apiKey: session.accessToken,
          clientId,
          data: { account_manager_id: userId },
          auditHeaders,
        });
        if (!result.ok) {
          setDetail(previous);
          if (result.error.kind === "canceled") return;
          logger.warn("Client account manager update failed", { error: result.error });
          setManagerError(
            result.error.kind === "permission"
              ? t("detail.errors.managerPermission", { defaultValue: "You do not have permission to update this client." })
              : t("detail.errors.managerGeneric", { defaultValue: "Unable to update the account manager. Try again." }),
          );
          return;
        }
        setManagerPickerOpen(false);
        await load();
      } finally {
        setManagerUpdating(false);
      }
    },
    [client, clientId, detail, load, managerUpdating, session, t],
  );

  const onShowMoreContacts = useCallback(async () => {
    if (!client || !session || contactsLoadingMore) return;
    setContactsLoadingMore(true);
    try {
      const nextPage = contactsPage + 1;
      const result = await getClientContacts(client, {
        apiKey: session.accessToken,
        clientId,
        page: nextPage,
        limit: CONTACTS_PAGE_SIZE,
      });
      if (!result.ok || !Array.isArray(result.data.data)) return;
      setContacts((current) => [...current, ...result.data.data]);
      setContactsTotal(result.data.pagination?.total ?? contactsTotal);
      setContactsPage(nextPage);
    } finally {
      setContactsLoadingMore(false);
    }
  }, [client, clientId, contactsLoadingMore, contactsPage, contactsTotal, session]);

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
  const notSet = t("detail.notSet", { defaultValue: "Not set" });

  const detailRows: {
    icon: keyof typeof Feather.glyphMap;
    label: string;
    value?: string | null;
    onPress?: () => void;
    accessory?: keyof typeof Feather.glyphMap;
  }[] = [
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
    { icon: "briefcase", label: t("detail.clientType", { defaultValue: "Client type" }), value: detail.client_type },
    { icon: "layers", label: t("detail.industry", { defaultValue: "Industry" }), value: detail.properties?.industry },
    {
      icon: "user",
      label: t("detail.accountManager"),
      value: detail.account_manager_full_name,
      onPress: openManagerPicker,
      accessory: "edit-2",
    },
  ];

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

      <Card style={{ marginTop: theme.spacing.lg, padding: 0 }}>
        {detailRows.map((row, index) => (
          <DetailRow
            key={row.label}
            theme={theme}
            icon={row.icon}
            label={row.label}
            value={row.value}
            placeholder={notSet}
            onPress={row.onPress}
            accessory={row.accessory}
            isLast={index === detailRows.length - 1}
          />
        ))}
      </Card>
      {managerError ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.xs }}>
          {managerError}
        </Text>
      ) : null}

      {contactsVisible ? (
        <>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
            {t("detail.contacts", { defaultValue: "Contacts" })}
          </Text>
          {contacts.length === 0 ? (
            <Card style={{ marginTop: theme.spacing.sm }}>
              <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
                {t("detail.noContacts", { defaultValue: "No contacts" })}
              </Text>
            </Card>
          ) : (
            <Card style={{ marginTop: theme.spacing.sm, padding: 0 }}>
              {contacts.map((contact, index) => {
                const reachLine = getContactReachLine(contact);
                return (
                  <Pressable
                    key={contact.contact_name_id}
                    accessibilityRole="button"
                    accessibilityLabel={t("detail.contactAccessibility", {
                      defaultValue: "Contact {{name}}",
                      name: contact.full_name,
                    })}
                    onPress={() =>
                      navigation.navigate("ContactDetail", {
                        contactId: contact.contact_name_id,
                        contactName: contact.full_name,
                      })
                    }
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      padding: theme.spacing.md,
                      borderBottomWidth: index === contacts.length - 1 && contacts.length >= contactsTotal ? 0 : 1,
                      borderBottomColor: theme.colors.borderLight,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Avatar
                      name={contact.full_name}
                      imageUri={buildContactAvatarUri(config.baseUrl, contact.avatarUrl)}
                      authToken={session.accessToken}
                      size="sm"
                    />
                    <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                      <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
                        {contact.full_name}
                      </Text>
                      {reachLine ? (
                        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                          {reachLine}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.colors.textSecondary} />
                  </Pressable>
                );
              })}
              {contacts.length < contactsTotal ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("detail.showMoreContacts", { defaultValue: "Show more" })}
                  disabled={contactsLoadingMore}
                  onPress={() => void onShowMoreContacts()}
                  style={({ pressed }) => ({
                    padding: theme.spacing.md,
                    alignItems: "center",
                    opacity: contactsLoadingMore ? 0.65 : pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "600" }}>
                    {t("detail.showMoreContacts", { defaultValue: "Show more" })}
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          )}
        </>
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

      <AccountManagerPickerModal
        visible={managerPickerOpen}
        updating={managerUpdating}
        updateError={managerError}
        onSelect={(userId, displayName) => void onSelectManager(userId, displayName)}
        onClose={() => setManagerPickerOpen(false)}
        client={client}
        apiKey={session.accessToken}
        baseUrl={config.baseUrl}
      />
    </ScrollView>
  );
}

function DetailRow({
  theme,
  icon,
  label,
  value,
  placeholder,
  onPress,
  accessory,
  isLast = false,
}: {
  theme: Theme;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value?: string | null;
  placeholder: string;
  onPress?: () => void;
  accessory?: keyof typeof Feather.glyphMap;
  isLast?: boolean;
}) {
  const displayValue = value || placeholder;
  const valueColor = value ? (onPress && !accessory ? theme.colors.primary : theme.colors.text) : theme.colors.textSecondary;
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
        <Text style={{ ...theme.typography.body, color: valueColor, marginTop: 2 }}>{displayValue}</Text>
      </View>
      {onPress ? (
        <Feather name={accessory ?? "external-link"} size={16} color={theme.colors.textSecondary} />
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${displayValue}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}
