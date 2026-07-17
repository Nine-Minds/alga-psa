import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import {
  getOpportunity,
  getOpportunityTimeline,
  winOpportunity,
  type OpportunityDetail,
  type TimelineItem,
} from "../api/opportunities";
import { listContacts, type ContactListItem } from "../api/contacts";
import { ErrorState, LoadingState } from "../ui/states";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { IconButton } from "../ui/components/IconButton";
import { useToast } from "../ui/toast/ToastProvider";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useAppResume } from "../hooks/useAppResume";
import { logger } from "../logging/logger";
import { StageBadge } from "../features/opportunities/components/StageBadge";
import { SecondaryButton } from "../features/opportunities/components/SecondaryButton";
import { CompleteActionModal } from "../features/opportunities/components/CompleteActionModal";
import { LogInteractionModal } from "../features/opportunities/components/LogInteractionModal";
import { FollowUpModal } from "../features/opportunities/components/FollowUpModal";
import { LoseOpportunityModal } from "../features/opportunities/components/LoseOpportunityModal";
import { WinConfirmModal } from "../features/opportunities/components/WinConfirmModal";
import { CallPromptBanner } from "../features/opportunities/components/CallPromptBanner";
import { formatCents, formatDate } from "../features/opportunities/opportunityFormat";
import { serverErrorMessage } from "../features/opportunities/opportunityErrors";
import { recordPendingCall, usePendingCallPrompt } from "../features/opportunities/hooks/usePendingCallPrompt";

type Props = NativeStackScreenProps<RootStackParamList, "OpportunityDetail">;

type LogPreset = { duration?: number; typeName?: string; contactNameId?: string | null } | null;

const FALLBACK_CONTACTS_SHOWN = 3;

export function OpportunityDetailScreen({ route, navigation }: Props) {
  const { opportunityId } = route.params;
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const { showToast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/opportunity-detail",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [deal, setDeal] = useState<OpportunityDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [clientContacts, setClientContacts] = useState<ContactListItem[]>([]);
  const [clientContactsTotal, setClientContactsTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [completeOpen, setCompleteOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logPreset, setLogPreset] = useState<LogPreset>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [loseOpen, setLoseOpen] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const [winSubmitting, setWinSubmitting] = useState(false);
  const [winError, setWinError] = useState<string | null>(null);

  const { prompt: callPrompt, dismiss: dismissCallPrompt } = usePendingCallPrompt(opportunityId);

  const fetchAll = useCallback(async () => {
    if (!client || !session) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    const [dealResult, timelineResult] = await Promise.all([
      getOpportunity(client, { apiKey: session.accessToken, opportunityId, signal: controller.signal }),
      getOpportunityTimeline(client, { apiKey: session.accessToken, opportunityId, signal: controller.signal }),
    ]);

    if (abortRef.current === controller) abortRef.current = null;
    if (controller.signal.aborted) return;

    if (!dealResult.ok) {
      if (dealResult.error.kind === "canceled") return;
      logger.warn("Opportunity detail fetch failed", { error: dealResult.error });
      setError(t("errors.unableToLoad", "Unable to load."));
      return;
    }
    const loaded = dealResult.data.data;
    setDeal(loaded);
    if (timelineResult.ok) {
      setTimeline(timelineResult.data.data);
    }

    // No linked contact — surface the client's contacts so the rep can still reach someone.
    if (!loaded.contact_id && loaded.client_id) {
      const contactsResult = await listContacts(client, {
        apiKey: session.accessToken,
        page: 1,
        limit: FALLBACK_CONTACTS_SHOWN,
        client_id: loaded.client_id,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (contactsResult.ok) {
        setClientContacts(contactsResult.data.data ?? []);
        setClientContactsTotal(contactsResult.data.pagination?.total ?? contactsResult.data.data?.length ?? 0);
      }
    } else {
      setClientContacts([]);
      setClientContactsTotal(0);
    }
  }, [client, opportunityId, session, t]);

  const { refreshing, refresh } = usePullToRefresh(fetchAll);
  useAppResume(() => void refresh());

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setInitialLoading(true);
      await fetchAll();
      if (!canceled) setInitialLoading(false);
    })();
    return () => {
      canceled = true;
    };
  }, [fetchAll]);

  useEffect(() => {
    if (deal?.title && deal.title !== route.params.title) {
      navigation.setParams({ title: deal.title });
    }
  }, [deal?.title, navigation, route.params.title]);

  const startCall = useCallback(
    (phone: string, contact: { name: string | null; id: string | null }) => {
      const startedAtMs = Date.now();
      // Arm the log-this-call prompt only once the dialer actually opens — on
      // devices that can't place calls (wifi-only iPads) the record would
      // otherwise fire on the next unrelated app resume.
      Linking.openURL(`tel:${phone}`)
        .then(() => {
          recordPendingCall({
            opportunityId,
            contactName: contact.name,
            contactId: contact.id,
            clientId: deal?.client_id ?? null,
            startedAtMs,
          });
        })
        .catch(() => {
          showToast({
            message: t("errors.callUnavailable", "This device can't place phone calls."),
            tone: "error",
          });
        });
    },
    [deal?.client_id, opportunityId, showToast, t],
  );

  const onCall = useCallback(() => {
    if (!deal?.contact_phone) return;
    startCall(deal.contact_phone, { name: deal.contact_name ?? null, id: deal.contact_id ?? null });
  }, [deal, startCall]);

  const openMailto = useCallback(
    (email: string) => {
      Linking.openURL(`mailto:${email}`).catch(() => {
        showToast({
          message: t("errors.emailUnavailable", "No email app is available on this device."),
          tone: "error",
        });
      });
    },
    [showToast, t],
  );

  const onEmail = useCallback(() => {
    if (!deal?.contact_email) return;
    openMailto(deal.contact_email);
  }, [deal?.contact_email, openMailto]);

  const openClient = useCallback(() => {
    if (!deal?.client_id) return;
    navigation.navigate("ClientDetail", { clientId: deal.client_id, clientName: deal.client_name });
  }, [deal?.client_id, deal?.client_name, navigation]);

  const openLog = useCallback((preset: LogPreset) => {
    setLogPreset(preset);
    setLogOpen(true);
  }, []);

  const onConfirmWin = useCallback(async () => {
    if (!client || !session) return;
    setWinSubmitting(true);
    setWinError(null);
    const result = await winOpportunity(client, { apiKey: session.accessToken, opportunityId });
    setWinSubmitting(false);
    if (!result.ok) {
      setWinError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    setWinOpen(false);
    showToast({
      message: t("won.body", "Close gates run on the server. Finish the conversion (agreement, project) on the web."),
      tone: "info",
      durationMs: 4000,
    });
    void fetchAll();
  }, [client, fetchAll, opportunityId, session, showToast, t]);

  if (!config.ok) {
    return <ErrorState title={t("common:configurationError", "Configuration error")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("common:signedOut", "Signed out")} description={t("common:signInAgain", "Please sign in again.")} />;
  }
  if (initialLoading && !deal) {
    return <LoadingState message={t("detail.loading", "Loading deal")} />;
  }
  if (!deal) {
    return (
      <ErrorState
        title={t("errors.unableToLoad", "Unable to load.")}
        description={error ?? undefined}
        action={<PrimaryButton onPress={() => void refresh()}>{t("common:retry", "Retry")}</PrimaryButton>}
      />
    );
  }

  const dueLabel = formatDate(deal.next_action_due);
  const sortedTimeline = [...timeline].sort((a, b) => timelineMs(b) - timelineMs(a));
  const linkedQuotes = deal.linked_quotes ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {/* Header */}
        <SectionCard theme={theme}>
          <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{deal.title}</Text>
          {deal.client_name ? (
            <Pressable
              testID="opportunity-detail-client-link"
              onPress={openClient}
              accessibilityRole="button"
              accessibilityLabel={t("detail.viewClient", "View client")}
              style={{ flexDirection: "row", alignItems: "center", marginTop: 2, alignSelf: "flex-start" }}
            >
              <Text style={{ ...theme.typography.body, color: theme.colors.primary }}>{deal.client_name}</Text>
              <Feather name="chevron-right" size={16} color={theme.colors.primary} style={{ marginLeft: 2 }} />
            </Pressable>
          ) : null}
          <View style={{ marginTop: theme.spacing.sm, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
            <StageBadge stage={deal.stage} />
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {deal.opportunity_number}
            </Text>
          </View>
          <ValuesRow theme={theme} deal={deal} t={t} />
          <FactsRow theme={theme} deal={deal} t={t} />
        </SectionCard>

        {/* Next action */}
        <SectionCard theme={theme} label={t("detail.nextAction", "Next action")}>
          <Text style={{ ...theme.typography.body, color: deal.next_action ? theme.colors.text : theme.colors.textSecondary }}>
            {deal.next_action ?? t("detail.noNextAction", "No next action set.")}
          </Text>
          {dueLabel ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
              {t("detail.due", "Due {{date}}", { date: dueLabel })}
            </Text>
          ) : null}
          <View style={{ marginTop: theme.spacing.md }}>
            <PrimaryButton
              onPress={() => setCompleteOpen(true)}
              accessibilityLabel={t("detail.complete", "Complete")}
            >
              {t("detail.complete", "Complete")}
            </PrimaryButton>
          </View>
        </SectionCard>

        {/* Contact */}
        {deal.contact_name ? (
          <SectionCard theme={theme} label={t("detail.contact", "Contact")}>
            <Pressable
              testID="opportunity-detail-contact-link"
              onPress={() => {
                if (!deal.contact_id) return;
                navigation.navigate("ContactDetail", { contactId: deal.contact_id, contactName: deal.contact_name ?? undefined });
              }}
              accessibilityRole="button"
              accessibilityLabel={t("detail.viewContact", "View contact")}
              style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start" }}
            >
              <Text style={{ ...theme.typography.bodyBold, color: theme.colors.text }}>{deal.contact_name}</Text>
              {deal.contact_id ? (
                <Feather name="chevron-right" size={16} color={theme.colors.textSecondary} style={{ marginLeft: 2 }} />
              ) : null}
            </Pressable>
            {deal.contact_phone ? (
              <ReachRow
                theme={theme}
                testID="opportunity-detail-call"
                icon="phone"
                value={deal.contact_phone}
                accessibilityLabel={t("detail.call", "Call")}
                onPress={onCall}
              />
            ) : null}
            {deal.contact_email ? (
              <ReachRow
                theme={theme}
                testID="opportunity-detail-email"
                icon="mail"
                value={deal.contact_email}
                accessibilityLabel={t("detail.email", "Email")}
                onPress={onEmail}
              />
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard theme={theme} label={t("detail.clientContacts", "Client contacts")}>
            {clientContacts.length === 0 ? (
              <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
                {t("detail.noContacts", "No contacts for this client yet.")}
              </Text>
            ) : (
              clientContacts.map((contact, index) => (
                <FallbackContactRow
                  key={contact.contact_name_id}
                  theme={theme}
                  contact={contact}
                  isLast={index === clientContacts.length - 1 && clientContactsTotal <= clientContacts.length}
                  t={t}
                  onOpen={() =>
                    navigation.navigate("ContactDetail", {
                      contactId: contact.contact_name_id,
                      contactName: contact.full_name,
                    })
                  }
                  onCall={(phone) => startCall(phone, { name: contact.full_name, id: contact.contact_name_id })}
                  onEmail={openMailto}
                />
              ))
            )}
            {clientContactsTotal > clientContacts.length ? (
              <Pressable
                testID="opportunity-detail-view-all-contacts"
                onPress={openClient}
                accessibilityRole="button"
                accessibilityLabel={t("detail.viewAllContacts", "View all ({{count}})", { count: clientContactsTotal })}
                style={{ marginTop: theme.spacing.sm, alignSelf: "flex-start" }}
              >
                <Text style={{ ...theme.typography.body, color: theme.colors.primary }}>
                  {t("detail.viewAllContacts", "View all ({{count}})", { count: clientContactsTotal })}
                </Text>
              </Pressable>
            ) : null}
          </SectionCard>
        )}

        {/* Pending call prompt */}
        {callPrompt ? (
          <CallPromptBanner
            prompt={callPrompt}
            onLog={() => {
              openLog({ duration: callPrompt.durationMinutes, typeName: "Call", contactNameId: callPrompt.contactId });
              dismissCallPrompt();
            }}
            onDismiss={dismissCallPrompt}
          />
        ) : null}

        {/* Linked quotes */}
        {linkedQuotes.length > 0 ? (
          <SectionCard theme={theme} label={t("detail.quotes", "Quotes")}>
            {linkedQuotes.map((quote, index) => (
              <View
                key={quote.quote_id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: theme.spacing.xs,
                  borderBottomWidth: index === linkedQuotes.length - 1 ? 0 : 1,
                  borderBottomColor: theme.colors.borderLight,
                }}
              >
                <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1 }}>
                  {quote.quote_number ?? quote.quote_id}
                </Text>
                {quote.status ? (
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginRight: theme.spacing.sm }}>
                    {quote.status}
                  </Text>
                ) : null}
                {quote.total_amount != null ? (
                  <Text style={{ ...theme.typography.bodyBold, color: theme.colors.text }}>
                    {formatCents(quote.total_amount, quote.currency_code)}
                  </Text>
                ) : null}
              </View>
            ))}
          </SectionCard>
        ) : null}

        {/* Timeline */}
        <SectionCard theme={theme} label={t("detail.timeline", "Timeline")}>
          {sortedTimeline.length === 0 ? (
            <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>
              {t("detail.timelineEmpty", "No interactions yet.")}
            </Text>
          ) : (
            sortedTimeline.map((entry, index) => (
              <TimelineRow
                key={entry.interaction_id}
                theme={theme}
                entry={entry}
                isLast={index === sortedTimeline.length - 1}
                t={t}
              />
            ))
          )}
        </SectionCard>

        {/* Footer actions */}
        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <SecondaryButton
              testID="opportunity-detail-log-interaction"
              onPress={() => openLog(null)}
              accessibilityLabel={t("detail.logInteraction", "Log interaction")}
            >
              {t("detail.logInteraction", "Log interaction")}
            </SecondaryButton>
            <SecondaryButton
              testID="opportunity-detail-schedule-follow-up"
              onPress={() => setFollowUpOpen(true)}
              accessibilityLabel={t("detail.scheduleFollowUp", "Schedule follow-up")}
            >
              {t("detail.scheduleFollowUp", "Schedule follow-up")}
            </SecondaryButton>
          </View>
          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <SecondaryButton
              testID="opportunity-detail-mark-won"
              onPress={() => {
                setWinError(null);
                setWinOpen(true);
              }}
              accessibilityLabel={t("detail.markWon", "Mark won")}
            >
              {t("detail.markWon", "Mark won")}
            </SecondaryButton>
            <SecondaryButton
              testID="opportunity-detail-mark-lost"
              tone="danger"
              onPress={() => setLoseOpen(true)}
              accessibilityLabel={t("detail.markLost", "Mark lost")}
            >
              {t("detail.markLost", "Mark lost")}
            </SecondaryButton>
          </View>
        </View>
      </ScrollView>

      <CompleteActionModal
        visible={completeOpen}
        currentAction={deal.next_action}
        client={client}
        apiKey={session.accessToken}
        opportunityId={opportunityId}
        onClose={() => setCompleteOpen(false)}
        onCompleted={() => void fetchAll()}
      />

      <LogInteractionModal
        visible={logOpen}
        client={client}
        apiKey={session.accessToken}
        opportunityId={opportunityId}
        clientId={deal.client_id}
        contactNameId={logPreset?.contactNameId ?? deal.contact_id}
        initialDuration={logPreset?.duration}
        preferTypeName={logPreset?.typeName}
        onClose={() => setLogOpen(false)}
        onLogged={() => void fetchAll()}
      />

      <FollowUpModal
        visible={followUpOpen}
        client={client}
        apiKey={session.accessToken}
        userId={session.user?.id ?? null}
        dealTitle={deal.title}
        onClose={() => setFollowUpOpen(false)}
        onScheduled={() => setFollowUpOpen(false)}
      />

      <LoseOpportunityModal
        visible={loseOpen}
        client={client}
        apiKey={session.accessToken}
        opportunityId={opportunityId}
        onClose={() => setLoseOpen(false)}
        onLost={() => void fetchAll()}
      />

      <WinConfirmModal
        visible={winOpen}
        submitting={winSubmitting}
        error={winError}
        onConfirm={() => void onConfirmWin()}
        onClose={() => setWinOpen(false)}
      />
    </View>
  );
}

function timelineMs(entry: TimelineItem): number {
  if (!entry.interaction_date) return 0;
  const ms = new Date(entry.interaction_date).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function ValuesRow({
  theme,
  deal,
  t,
}: {
  theme: Theme;
  deal: OpportunityDetail;
  t: (key: string, def: string) => string;
}) {
  const values: { label: string; value: string }[] = [];
  if (deal.mrr_cents != null) {
    values.push({ label: t("detail.mrr", "MRR"), value: formatCents(deal.mrr_cents, deal.currency_code) });
  }
  if (deal.nrr_cents != null) {
    values.push({ label: t("detail.nrr", "NRR"), value: formatCents(deal.nrr_cents, deal.currency_code) });
  }
  if (deal.hardware_cents != null) {
    values.push({ label: t("detail.hardware", "Hardware"), value: formatCents(deal.hardware_cents, deal.currency_code) });
  }
  if (values.length === 0) return null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
      {values.map((item) => (
        <View key={item.label}>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{item.label}</Text>
          <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600", marginTop: 2 }}>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function FactsRow({
  theme,
  deal,
  t,
}: {
  theme: Theme;
  deal: OpportunityDetail;
  t: (key: string, def: string) => string;
}) {
  const facts: { label: string; value: string }[] = [];
  const expectedClose = formatDate(deal.expected_close_date);
  if (expectedClose) {
    facts.push({ label: t("detail.expectedClose", "Expected close"), value: expectedClose });
  }
  if (deal.confidence) {
    facts.push({
      label: t("detail.confidence", "Confidence"),
      value: t(`confidence.${deal.confidence}`, deal.confidence),
    });
  }
  if (deal.owner_name) {
    facts.push({ label: t("detail.owner", "Owner"), value: deal.owner_name });
  }
  if (facts.length === 0) return null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
      {facts.map((item) => (
        <View key={item.label}>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{item.label}</Text>
          <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: 2 }}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function ReachRow({
  theme,
  testID,
  icon,
  value,
  accessibilityLabel,
  onPress,
}: {
  theme: Theme;
  testID: string;
  icon: "phone" | "mail";
  value: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing.sm }}
    >
      <Feather name={icon} size={16} color={theme.colors.primary} />
      <Text style={{ ...theme.typography.body, color: theme.colors.primary, marginLeft: theme.spacing.sm }}>
        {value}
      </Text>
    </Pressable>
  );
}

function FallbackContactRow({
  theme,
  contact,
  isLast,
  t,
  onOpen,
  onCall,
  onEmail,
}: {
  theme: Theme;
  contact: ContactListItem;
  isLast: boolean;
  t: (key: string, def: string) => string;
  onOpen: () => void;
  onCall: (phone: string) => void;
  onEmail: (email: string) => void;
}) {
  const phone = contact.default_phone_number?.trim() || contact.phone_numbers?.[0]?.phone_number?.trim() || null;
  const email = contact.email?.trim() || null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.xs,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.colors.borderLight,
      }}
    >
      <Pressable
        testID={`opportunity-detail-client-contact-${contact.contact_name_id}`}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t("detail.viewContact", "View contact")}
        style={{ flex: 1 }}
      >
        <Text style={{ ...theme.typography.body, color: theme.colors.text }} numberOfLines={1}>
          {contact.full_name}
        </Text>
        {phone || email ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 1 }} numberOfLines={1}>
            {phone ?? email}
          </Text>
        ) : null}
      </Pressable>
      {phone ? (
        <IconButton
          testID={`opportunity-detail-client-contact-call-${contact.contact_name_id}`}
          icon={<Feather name="phone" size={18} color={theme.colors.primary} />}
          onPress={() => onCall(phone)}
          accessibilityLabel={t("detail.call", "Call")}
        />
      ) : null}
      {email ? (
        <IconButton
          testID={`opportunity-detail-client-contact-email-${contact.contact_name_id}`}
          icon={<Feather name="mail" size={18} color={theme.colors.primary} />}
          onPress={() => onEmail(email)}
          accessibilityLabel={t("detail.email", "Email")}
        />
      ) : null}
    </View>
  );
}

function TimelineRow({
  theme,
  entry,
  isLast,
  t,
}: {
  theme: Theme;
  entry: TimelineItem;
  isLast: boolean;
  t: (key: string, def: string, opts?: Record<string, unknown>) => string;
}) {
  const date = formatDate(entry.interaction_date);
  const meta = [entry.user_name, date].filter(Boolean).join(" · ");
  return (
    <View
      style={{
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.colors.borderLight,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ ...theme.typography.bodyBold, color: theme.colors.text, flex: 1 }} numberOfLines={1}>
          {entry.title || entry.type_name || t("detail.logInteraction", "Log interaction")}
        </Text>
        {entry.duration != null ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
            {t("detail.durationMinutes", "{{count}} min", { count: entry.duration })}
          </Text>
        ) : null}
      </View>
      {entry.type_name ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
          {entry.type_name}
        </Text>
      ) : null}
      {meta ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>{meta}</Text>
      ) : null}
    </View>
  );
}

function SectionCard({ theme, label, children }: { theme: Theme; label?: string; children: ReactNode }) {
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
      {label ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
          {label}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
