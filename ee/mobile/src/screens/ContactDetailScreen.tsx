import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CommonActions } from "@react-navigation/native";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import {
  buildContactAvatarUri,
  formatContactTypeLabel,
  getContact,
  type ContactDetail,
  type ContactEmailAddress,
  type ContactPhoneNumber,
} from "../api/contacts";
import { ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { Avatar } from "../ui/components/Avatar";
import { Badge } from "../ui/components/Badge";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { logger } from "../logging/logger";

type Props = NativeStackScreenProps<RootStackParamList, "ContactDetail">;

export function ContactDetailScreen({ route, navigation }: Props) {
  const { contactId } = route.params;
  const { t } = useTranslation("contacts");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const abortRef = useRef<AbortController | null>(null);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/contact-detail",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContact = useCallback(async () => {
    if (!client || !session) return;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setError(null);

    const result = await getContact(client, {
      apiKey: session.accessToken,
      contactId,
      signal: abortController.signal,
    });

    if (abortRef.current === abortController) {
      abortRef.current = null;
    }
    if (abortController.signal.aborted) return;

    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("Contact detail fetch failed", { error: result.error });
      setError(t("detail.unableToLoadDescription"));
      return;
    }

    setContact(result.data.data);
  }, [client, contactId, session, t]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      setInitialLoading(true);
      await fetchContact();
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [fetchContact]);

  useEffect(() => {
    if (contact?.full_name && contact.full_name !== route.params.contactName) {
      navigation.setParams({ contactName: contact.full_name });
    }
  }, [contact?.full_name, navigation, route.params.contactName]);

  const { refreshing, refresh } = usePullToRefresh(fetchContact);

  const typeLabel = useCallback(
    (entry: Pick<ContactPhoneNumber, "canonical_type" | "custom_type">) => {
      const custom = entry.custom_type?.trim();
      if (custom) return custom;
      const canonical = entry.canonical_type?.trim().toLowerCase();
      if (!canonical) return null;
      return t(`detail.types.${canonical}`, { defaultValue: formatContactTypeLabel(entry) ?? canonical });
    },
    [t],
  );

  const onViewTickets = useCallback(() => {
    navigation.dispatch(
      CommonActions.navigate("Tabs", {
        screen: "TicketsTab",
        params: {
          screen: "TicketsList",
          params: { contactId, contactName: contact?.full_name ?? route.params.contactName },
        },
      }),
    );
  }, [contact?.full_name, contactId, navigation, route.params.contactName]);

  const onOpenClient = useCallback(() => {
    if (!contact?.client_id) return;
    navigation.navigate("ClientDetail", {
      clientId: contact.client_id,
      clientName: contact.client_name ?? undefined,
    });
  }, [contact?.client_id, contact?.client_name, navigation]);

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }

  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }

  if (initialLoading && !contact) {
    return <LoadingState message={t("detail.loadingContact")} />;
  }

  if (!contact) {
    return (
      <ErrorState
        title={t("detail.unableToLoad")}
        description={error ?? t("detail.unableToLoadDescription")}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  }

  const phones = contact.phone_numbers ?? [];
  const primaryEmail = contact.email?.trim() || null;
  const additionalEmails = (contact.additional_email_addresses ?? []).filter(
    (entry) => entry.email_address?.trim(),
  );
  const hasContactInfo = phones.length > 0 || Boolean(primaryEmail) || additionalEmails.length > 0;
  const notes = contact.notes?.trim() || null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Avatar
          name={contact.full_name}
          imageUri={buildContactAvatarUri(config.baseUrl, contact.avatarUrl)}
          authToken={session.accessToken}
          size="lg"
        />
        <View style={{ marginLeft: theme.spacing.md, flex: 1 }}>
          <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{contact.full_name}</Text>
          {contact.role ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
              {contact.role}
            </Text>
          ) : null}
          {contact.is_inactive ? (
            <View style={{ marginTop: theme.spacing.xs }}>
              <Badge label={t("detail.inactive")} tone="warning" />
            </View>
          ) : null}
        </View>
      </View>

      {error ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ marginTop: theme.spacing.lg }}>
        <PrimaryButton onPress={onViewTickets}>
          {t("detail.viewTickets", { defaultValue: "View tickets" })}
        </PrimaryButton>
      </View>

      <SectionCard theme={theme} label={t("detail.client")}>
        {contact.client_id ? (
          <Pressable
            onPress={onOpenClient}
            accessibilityRole="button"
            accessibilityLabel={t("detail.viewClientAccessibility", {
              defaultValue: "View client {{name}}",
              name: contact.client_name ?? t("detail.client"),
            })}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ ...theme.typography.body, color: theme.colors.primary, flex: 1 }}>
              {contact.client_name ?? t("detail.viewClient", { defaultValue: "View client" })}
            </Text>
            <Feather name="chevron-right" size={16} color={theme.colors.textSecondary} />
          </Pressable>
        ) : (
          <Text style={{ ...theme.typography.body, color: contact.client_name ? theme.colors.text : theme.colors.textSecondary }}>
            {contact.client_name ?? t("detail.noClient")}
          </Text>
        )}
      </SectionCard>

      <SectionCard theme={theme} label={t("detail.contactInfo")}>
        {hasContactInfo ? (
          <View>
            {phones.map((phone, index) => (
              <PhoneRow
                key={phone.contact_phone_number_id ?? `${phone.phone_number}-${index}`}
                theme={theme}
                phone={phone}
                label={typeLabel(phone) ?? t("detail.phone")}
                contactName={contact.full_name}
              />
            ))}
            {primaryEmail ? (
              <EmailRow
                theme={theme}
                email={primaryEmail}
                label={t("detail.email")}
                contactName={contact.full_name}
              />
            ) : null}
            {additionalEmails.map((entry: ContactEmailAddress, index) => (
              <EmailRow
                key={entry.contact_additional_email_address_id ?? `${entry.email_address}-${index}`}
                theme={theme}
                email={entry.email_address}
                label={typeLabel(entry) ?? t("detail.email")}
                contactName={contact.full_name}
              />
            ))}
          </View>
        ) : (
          <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
            {t("detail.noContactInfo")}
          </Text>
        )}
      </SectionCard>

      {notes ? (
        <SectionCard theme={theme} label={t("detail.notes")}>
          <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{notes}</Text>
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

function SectionCard({ theme, label, children }: { theme: Theme; label: string; children: ReactNode }) {
  return (
    <View
      style={{
        marginTop: theme.spacing.lg,
        padding: theme.spacing.md,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function PhoneRow({
  theme,
  phone,
  label,
  contactName,
}: {
  theme: Theme;
  phone: ContactPhoneNumber;
  label: string;
  contactName: string;
}) {
  const { t } = useTranslation("contacts");
  return (
    <Pressable
      onPress={() => void Linking.openURL(`tel:${phone.phone_number}`)}
      accessibilityRole="button"
      accessibilityLabel={t("detail.callAccessibility", { name: contactName, number: phone.phone_number })}
      style={({ pressed }) => ({ paddingVertical: theme.spacing.sm, opacity: pressed ? 0.95 : 1 })}
    >
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.primary, marginTop: 2 }}>
        {phone.phone_number}
      </Text>
    </Pressable>
  );
}

function EmailRow({
  theme,
  email,
  label,
  contactName,
}: {
  theme: Theme;
  email: string;
  label: string;
  contactName: string;
}) {
  const { t } = useTranslation("contacts");
  return (
    <Pressable
      onPress={() => void Linking.openURL(`mailto:${email}`)}
      accessibilityRole="button"
      accessibilityLabel={t("detail.emailAccessibility", { name: contactName, email })}
      style={({ pressed }) => ({ paddingVertical: theme.spacing.sm, opacity: pressed ? 0.95 : 1 })}
    >
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.primary, marginTop: 2 }}>{email}</Text>
    </Pressable>
  );
}
