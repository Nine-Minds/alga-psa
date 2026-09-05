import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { listUsers, getUserDisplayName } from "../api/users";
import type { MentionSuggestionItem } from "../features/ticketRichText/MentionSuggestionList";
import { ErrorState, LoadingState } from "../ui/states";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useToast } from "../ui/toast/ToastProvider";
import { Avatar } from "../ui/components/Avatar";
import { formatDateTimeWithRelative } from "../ui/formatters/dateTime";
import type { TicketRichTextQaScenario } from "../qa/ticketRichTextQa";

// Hooks
import { useTicketData } from "../features/ticketDetail/hooks/useTicketData";
import { useCommentDraft } from "../features/ticketDetail/hooks/useCommentDraft";
import { useDescriptionEditor } from "../features/ticketDetail/hooks/useDescriptionEditor";
import { useTicketStatus } from "../features/ticketDetail/hooks/useTicketStatus";
import { useTicketPriority } from "../features/ticketDetail/hooks/useTicketPriority";
import { useTicketDueDate } from "../features/ticketDetail/hooks/useTicketDueDate";
import { useTicketWatch } from "../features/ticketDetail/hooks/useTicketWatch";
import { useTimeEntry } from "../features/ticketDetail/hooks/useTimeEntry";
import { useTicketAssignment } from "../features/ticketDetail/hooks/useTicketAssignment";
import { useTicketTitle } from "../features/ticketDetail/hooks/useTicketTitle";
import { useTicketContact } from "../features/ticketDetail/hooks/useTicketContact";
import { useTicketTags } from "../features/ticketDetail/hooks/useTicketTags";
import { useTicketChecklist } from "../features/ticketDetail/hooks/useTicketChecklist";
import { useTicketQa } from "../features/ticketDetail/hooks/useTicketQa";

// Components
import { ActionChip } from "../features/ticketDetail/components/ActionChip";
import { KeyValue } from "../features/ticketDetail/components/KeyValue";
import { TicketMetaBar } from "../features/ticketDetail/components/TicketMetaBar";
import { MoreActionsSheet } from "../features/ticketDetail/components/MoreActionsSheet";
import { DueDateModal } from "../features/ticketDetail/components/DueDateModal";
import { TimeEntryModal } from "../features/ticketDetail/components/TimeEntryModal";
import { PriorityPickerModal } from "../features/ticketDetail/components/PriorityPickerModal";
import { StatusPickerModal } from "../features/ticketDetail/components/StatusPickerModal";
import { AgentPickerModal } from "../features/ticketDetail/components/AgentPickerModal";
import { ContactPickerModal } from "../features/ticketDetail/components/ContactPickerModal";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "../features/ticketDetail/components/TicketUpdateFooter";
import { TagsSection } from "../features/ticketDetail/components/TagsSection";
import { TagPickerModal } from "../features/ticketDetail/components/TagPickerModal";
import { ChecklistSection } from "../features/ticketDetail/components/ChecklistSection";
import { TicketTimerChip } from "../features/timer/components/TicketTimerChip";
import { useTimer } from "../features/timer/TimerContext";

// Utils
import { getDueDateIso, getWatcherUserIds, isoToDateInput, stringOrDash } from "../features/ticketDetail/utils";

// Re-exports for backward compatibility
export { CommentComposer } from "../features/ticketDetail/components/CommentComposer";
export { CommentsSection } from "../features/ticketDetail/components/CommentsSection";
export { DescriptionSection } from "../features/ticketDetail/components/DescriptionSection";
export { extractDescription } from "../features/ticketDetail/utils";

// Lazy imports for sections used in JSX
import { CommentComposer } from "../features/ticketDetail/components/CommentComposer";
import { CommentsSection } from "../features/ticketDetail/components/CommentsSection";
import { DescriptionSection } from "../features/ticketDetail/components/DescriptionSection";
import { DocumentsSection } from "../features/ticketDetail/components/DocumentsSection";
import { MaterialsSection } from "../features/ticketDetail/components/MaterialsSection";
import { AssetsSection } from "../features/ticketDetail/components/AssetsSection";
import { TimeEntriesSection } from "../features/ticketDetail/components/TimeEntriesSection";
import { TicketDetailsSection } from "../features/ticketDetail/components/TicketDetailsSection";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

export function TicketDetailScreen({ route, navigation }: Props) {
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  return (
    <TicketDetailBody
      ticketId={route.params.ticketId}
      qaScenario={route.params.qaScenario}
      config={config}
      session={session}
      refreshSession={refreshSession}
      navigation={navigation}
    />
  );
}

export function TicketDetailBody({
  ticketId,
  qaScenario,
  config,
  session,
  refreshSession,
  navigation,
}: {
  ticketId: string;
  qaScenario?: TicketRichTextQaScenario;
  config: ReturnType<typeof getAppConfig>;
  session: ReturnType<typeof useAuth>["session"];
  refreshSession: ReturnType<typeof useAuth>["refreshSession"];
  navigation?: Props["navigation"];
}) {
  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/ticket-detail",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const theme = useTheme();
  const { colors, spacing, typography } = theme;
  const { showToast } = useToast();
  const { t } = useTranslation("tickets");
  const network = useNetworkStatus();
  const isOffline = isOfflineStatus(network);
  const scrollRef = useRef<ScrollView>(null);
  const sectionsYRef = useRef(0);
  const checklistYRef = useRef(0);

  const imageAuth = useMemo(() => {
    if (!config.ok || !session) return undefined;
    return { baseUrl: config.baseUrl, apiKey: session.accessToken };
  }, [config, session]);

  const mentionUsersCache = useRef<MentionSuggestionItem[]>([]);

  const handleMentionSearch = useCallback(async (query: string, signal: AbortSignal): Promise<MentionSuggestionItem[]> => {
    if (!client || !session) return [];
    const results: MentionSuggestionItem[] = [];
    if (!query || "everyone".includes(query.toLowerCase())) {
      results.push({ user_id: "@everyone", username: "everyone", display_name: "Everyone", avatar_url: null });
    }

    // Fetch all internal users on first empty query, then filter client-side
    // for subsequent typed queries. This avoids issues where the server search
    // endpoint may not match partial names the same way.
    if (!query) {
      const res = await listUsers(client, { apiKey: session.accessToken, limit: 50, signal });
      if (res.ok) {
        const mapped = res.data.data.map((u) => ({
          user_id: u.user_id,
          username: u.username,
          display_name: getUserDisplayName(u),
          avatar_url: u.avatarUrl,
        }));
        mentionUsersCache.current = mapped;
        results.push(...mapped);
      }
    } else {
      const lowerQuery = query.toLowerCase();
      // Client-side filter from cached users
      const filtered = mentionUsersCache.current.filter((u) =>
        u.display_name.toLowerCase().includes(lowerQuery)
        || u.username.toLowerCase().includes(lowerQuery)
      );
      if (filtered.length > 0) {
        results.push(...filtered);
      } else {
        // Fall back to server search if cache has no matches
        const res = await listUsers(client, { apiKey: session.accessToken, search: query, limit: 10, signal });
        if (res.ok) {
          for (const u of res.data.data) {
            results.push({
              user_id: u.user_id,
              username: u.username,
              display_name: getUserDisplayName(u),
              avatar_url: u.avatarUrl,
            });
          }
        }
      }
    }
    return results;
  }, [client, session]);

  const deps = { client, session, ticketId, showToast, t };

  // --- Hooks ---
  const ticketData = useTicketData(deps);
  const { ticket, initialLoading, error, comments, commentsError, refreshing, refresh, fetchTicket, fetchComments, setComments } = ticketData;

  const commentDraftHook = useCommentDraft({ ...deps, isOffline, fetchTicket, fetchComments, setComments });
  const descEditor = useDescriptionEditor({ ...deps, ticket, setTicket: ticketData.setTicket });
  const checklistHook = useTicketChecklist(deps);
  const boardId = ticket?.board_id as string | undefined;
  const statusHook = useTicketStatus({
    ...deps,
    fetchTicket,
    boardId,
    onChecklistBlocked: () => {
      void checklistHook.fetchChecklist();
      scrollRef.current?.scrollTo({ y: Math.max(0, sectionsYRef.current + checklistYRef.current - spacing.md), animated: true });
    },
  });
  const priorityHook = useTicketPriority({ ...deps, fetchTicket });
  const dueDateHook = useTicketDueDate({ ...deps, ticket, fetchTicket });
  const watchHook = useTicketWatch({ ...deps, ticket, fetchTicket });
  const [timeEntriesRefreshKey, setTimeEntriesRefreshKey] = useState(0);
  const timeEntryHook = useTimeEntry(deps, {
    onCreated: () => setTimeEntriesRefreshKey((value) => value + 1),
  });
  const timer = useTimer();
  const timerLastStoppedAt = timer.lastStopped?.workItemId === ticketId ? timer.lastStopped.at : null;
  useEffect(() => {
    if (timerLastStoppedAt !== null) setTimeEntriesRefreshKey((value) => value + 1);
  }, [timerLastStoppedAt]);
  const assignmentHook = useTicketAssignment({ ...deps, fetchTicket });
  const contactHook = useTicketContact({ ...deps, fetchTicket });
  const tagsHook = useTicketTags(deps);
  const titleHook = useTicketTitle({ ...deps, ticket, setTicket: ticketData.setTicket });
  const qaHook = useTicketQa({
    qaScenario,
    ticketId,
    ticket,
    comments,
    initialLoading,
    draftLoaded: commentDraftHook.draftLoaded,
    persistDescriptionContent: descEditor.persistDescriptionContent,
    submitCommentPayload: commentDraftHook.submitCommentPayload,
    startDescriptionEditing: descEditor.startDescriptionEditing,
    setDescriptionDraft: descEditor.setDescriptionDraft,
    setDescriptionPlainText: descEditor.setDescriptionPlainText,
    setCommentDraft: commentDraftHook.setCommentDraft,
    setCommentDraftPlainText: commentDraftHook.setCommentDraftPlainText,
  });

  // --- Set nav header to ticket number ---
  useEffect(() => {
    if (ticket?.ticket_number && navigation) {
      navigation.setOptions({ title: ticket.ticket_number });
    }
  }, [ticket?.ticket_number, navigation]);

  const [composerCollapsed, setComposerCollapsed] = useState(true);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [titleSuppression, setTitleSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);

  const renderEntityValue = useCallback((name: string | null | undefined, imageUri: string | null | undefined, accessibilityLabel: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Avatar
        name={name ?? undefined}
        imageUri={imageUri ?? undefined}
        authToken={session?.accessToken}
        size="sm"
        accessibilityLabel={accessibilityLabel}
      />
      <Text style={{ ...typography.body, color: colors.text, flexShrink: 1 }}>
        {stringOrDash(name)}
      </Text>
    </View>
  ), [colors.text, session?.accessToken, spacing.sm, typography.body]);

  // --- Guard returns ---
  if (!config.ok) {
    return <ErrorState title={t("common:configurationError")} description={config.error} />;
  }
  if (!session) {
    return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  }
  if (initialLoading && !ticket) {
    return <LoadingState message={t("detail.loadingTicket")} />;
  }
  if (error && !ticket) {
    return <ErrorState title={error.title} description={error.description} />;
  }
  if (!ticket) {
    return <ErrorState title={t("detail.ticketNotFound")} description={t("detail.ticketUnavailable")} />;
  }

  // --- Derived values ---
  const statusLabel = statusHook.pendingStatusId
    ? (statusHook.statusOptions.find((s) => s.status_id === statusHook.pendingStatusId)?.name ??
      ticket.status_name ??
      t("common:unknown"))
    : (ticket.status_name ?? t("common:unknown"));

  const meUserId = session.user?.id;
  const isWatching = meUserId ? getWatcherUserIds(ticket).includes(meUserId) : false;

  // --- Render ---
  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl
          refreshing={refreshing}
          onRefresh={() => { void Promise.all([refresh(), tagsHook.fetchTags(), checklistHook.fetchChecklist()]); }}
        />}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: 12,
              backgroundColor: colors.badge.warning.bg,
              borderWidth: 1,
              borderColor: colors.warning,
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ ...typography.caption, color: colors.badge.warning.text, fontWeight: "700" }}>{error.title}</Text>
            <Text style={{ ...typography.caption, color: colors.badge.warning.text, marginTop: 2 }}>{error.description}</Text>
          </View>
        ) : null}

        {qaHook.qaStatus ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: 12,
              backgroundColor:
                qaHook.qaStatus.state === "failed"
                  ? colors.badge.danger.bg
                  : qaHook.qaStatus.state === "passed"
                    ? colors.badge.success.bg
                    : colors.badge.info.bg,
              borderWidth: 1,
              borderColor:
                qaHook.qaStatus.state === "failed"
                  ? colors.danger
                  : qaHook.qaStatus.state === "passed"
                    ? colors.success
                    : colors.info,
              marginBottom: spacing.md,
            }}
          >
            <Text style={{ ...typography.caption, color: colors.text, fontWeight: "700" }}>
              QA {qaHook.qaStatus.scenario}
            </Text>
            <Text style={{ ...typography.caption, color: colors.text, marginTop: 2 }}>
              {qaHook.qaStatus.state.toUpperCase()} - {qaHook.qaStatus.step}
            </Text>
            {qaHook.qaStatus.detail ? (
              <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                {qaHook.qaStatus.detail}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={{ ...typography.caption, color: colors.textSecondary }}>
          {ticket.ticket_number}
          {ticket.client_name ? ` • ${ticket.client_name}` : ""}
          {ticket.contact_name ? ` • ${ticket.contact_name}` : ""}
        </Text>
        {titleHook.titleEditing ? (
          <View style={{ marginTop: 2 }}>
            <View>
              <TextInput
                value={titleHook.titleDraft}
                onChangeText={titleHook.setTitleDraft}
                editable={!titleHook.titleSaving}
                autoFocus
                style={{
                  ...typography.title,
                  flex: 1,
                  color: colors.text,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  backgroundColor: colors.card,
                }}
                returnKeyType="done"
              />
            </View>
            {titleHook.titleError ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.xs }}>
                {titleHook.titleError}
              </Text>
            ) : null}
            <TicketUpdateFooter
              suppression={titleSuppression}
              onSuppressionChange={setTitleSuppression}
              onCancel={() => {
                titleHook.cancelTitleEditing();
                setTitleSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
              }}
              onApply={() => {
                void titleHook.saveTitle(activeTicketNotificationSuppression(titleSuppression)).then((saved) => {
                  if (saved) setTitleSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
                });
              }}
              applyLabel={t("detail.saveTitle", "Save title")}
              applyDisabled={!titleHook.titleDraft.trim() || titleHook.titleDraft.trim() === ticket.title}
              busy={titleHook.titleSaving}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setTitleSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
              titleHook.startTitleEditing();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("detail.editTitle")}
          >
            <Text accessibilityRole="header" style={{ ...typography.title, marginTop: 2, color: colors.text }}>
              {ticket.title}
            </Text>
          </Pressable>
        )}

        <View style={{ marginTop: spacing.sm }}>
          <TicketMetaBar
            statusLabel={statusLabel}
            statusIsClosed={Boolean(ticket.status_is_closed)}
            priorityName={ticket.priority_name ?? null}
            assignedToName={ticket.assigned_to_name ?? null}
            dueDateIso={getDueDateIso(ticket)}
            assigneeDisabled={assignmentHook.assignmentUpdating}
            onStatusPress={() => { void statusHook.openStatusPicker(); }}
            onPriorityPress={() => { void priorityHook.openPriorityPicker(); }}
            onAssigneePress={assignmentHook.openAgentPicker}
            onDuePress={() => {
              dueDateHook.setDueDateDraft(isoToDateInput(getDueDateIso(ticket)) ?? "");
              dueDateHook.setDueDateOpen(true);
            }}
          />
        </View>

        <View style={{ marginTop: spacing.md }}>
          <DescriptionSection
            ticket={ticket}
            isEditing={descEditor.descriptionEditing}
            draftContent={descEditor.descriptionDraft}
            draftPlainText={descEditor.descriptionPlainText}
            saving={descEditor.descriptionSaving}
            error={descEditor.descriptionError}
            editorRef={descEditor.descriptionEditorRef}
            onLinkPress={qaHook.handleRichTextLinkPress}
            qaAutoPressFirstLink={qaHook.qaAutoPressLink}
            imageAuth={imageAuth}
            onStartEditing={descEditor.startDescriptionEditing}
            onCancelEditing={descEditor.cancelDescriptionEditing}
            onSave={(notificationSuppression) => descEditor.saveDescription(notificationSuppression)}
            onMentionSearch={handleMentionSearch}
            mentionBaseUrl={config.ok ? config.baseUrl : null}
            mentionAuthToken={session?.accessToken}
            onDraftChange={(nextContent, nextPlainText) => {
              descEditor.setDescriptionDraft(nextContent);
              descEditor.setDescriptionPlainText(nextPlainText);
            }}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md, gap: spacing.sm }}>
          <TicketTimerChip ticketId={ticketId} />
          <ActionChip
            label={t("detail.addTime")}
            onPress={() => { timeEntryHook.openTimeEntryModal(); }}
          />
          <ActionChip
            label={t("detail.more", { defaultValue: "More" })}
            onPress={() => setMoreActionsOpen(true)}
          />
        </View>

        {watchHook.watchError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {watchHook.watchError}
          </Text>
        ) : null}

        {assignmentHook.assignmentError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {assignmentHook.assignmentError}
          </Text>
        ) : null}

        <View
          style={{ marginTop: spacing.lg }}
          onLayout={(event) => { sectionsYRef.current = event.nativeEvent.layout.y; }}
        >
          <View onLayout={(event) => { checklistYRef.current = event.nativeEvent.layout.y; }}>
            <ChecklistSection
              items={checklistHook.items}
              loading={checklistHook.loading}
              hidden={checklistHook.hidden}
              error={checklistHook.error}
              actionError={checklistHook.actionError}
              adding={checklistHook.adding}
              updatingIds={checklistHook.updatingIds}
              onAdd={checklistHook.addItem}
              onToggle={(item) => { void checklistHook.toggleItem(item); }}
              initiallyCollapsed
            />
          </View>
          <View style={{ height: spacing.sm }} />
          <CommentsSection
            comments={comments}
            visibleCount={commentDraftHook.commentsVisibleCount}
            onLoadMore={() => commentDraftHook.setCommentsVisibleCount((c) => c + 20)}
            error={commentsError}
            onLinkPress={qaHook.handleRichTextLinkPress}
            imageAuth={imageAuth}
            baseUrl={config.ok ? config.baseUrl : null}
            ticketId={ticketId}
            onCommentUpdated={() => void fetchComments()}
            onSubmitReply={commentDraftHook.submitReply}
            initiallyCollapsed
          />
          <View style={{ height: spacing.sm }} />
          <CommentComposer
            draftContent={commentDraftHook.commentDraft}
            draftPlainText={commentDraftHook.commentDraftPlainText}
            isInternal={commentDraftHook.commentIsInternal}
            onChangeIsInternal={commentDraftHook.setCommentIsInternal}
            isResolution={commentDraftHook.commentIsResolution}
            onChangeIsResolution={(value) => {
              commentDraftHook.setCommentIsResolution(value);
              if (!value) {
                commentDraftHook.setCommentCloseStatusId(null);
              } else if (statusHook.statusOptions.length === 0) {
                void statusHook.openStatusPicker();
                statusHook.setStatusPickerOpen(false);
              }
            }}
            closedStatuses={statusHook.statusOptions.filter((s) => s.is_closed)}
            closeStatusId={commentDraftHook.commentCloseStatusId}
            onChangeCloseStatusId={commentDraftHook.setCommentCloseStatusId}
            onSend={(notificationSuppression) => void commentDraftHook.sendComment(notificationSuppression)}
            sending={commentDraftHook.commentSending}
            offline={isOffline}
            error={commentDraftHook.commentSendError}
            editorRef={commentDraftHook.commentEditorRef}
            onDraftChange={(nextContent, nextPlainText) => {
              commentDraftHook.setCommentDraft(nextContent);
              commentDraftHook.setCommentDraftPlainText(nextPlainText);
            }}
            collapsed={composerCollapsed}
            onToggleCollapse={() => setComposerCollapsed((v) => !v)}
            onMentionSearch={handleMentionSearch}
            mentionBaseUrl={config.ok ? config.baseUrl : null}
            mentionAuthToken={session?.accessToken}
          />
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <TicketDetailsSection initiallyCollapsed>
          <KeyValue
            label={t("detail.contact")}
            value={renderEntityValue(
              ticket.contact_name,
              typeof ticket.contact_avatar_url === "string" ? ticket.contact_avatar_url : null,
              t("detail.contact"),
            )}
          >
            {ticket.contact_phone ? (
              <Pressable
                onPress={() => void Linking.openURL(`tel:${ticket.contact_phone}`)}
                accessibilityRole="button"
                accessibilityLabel={t("detail.callContact", { name: ticket.contact_name ?? "" })}
                style={{ marginTop: spacing.xs, paddingVertical: spacing.xs }}
              >
                <Text style={{ ...typography.caption, color: colors.primary }}>
                  {t("detail.contactPhone")}: {ticket.contact_phone}
                </Text>
              </Pressable>
            ) : null}
            {ticket.contact_email ? (
              <Pressable
                onPress={() => void Linking.openURL(`mailto:${ticket.contact_email}`)}
                accessibilityRole="button"
                accessibilityLabel={t("detail.emailContact", { name: ticket.contact_name ?? "" })}
                style={{ marginTop: spacing.xs, paddingVertical: spacing.xs }}
              >
                <Text style={{ ...typography.caption, color: colors.primary }}>
                  {t("detail.contactEmail")}: {ticket.contact_email}
                </Text>
              </Pressable>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm, gap: spacing.sm }}>
              <ActionChip
                label={t("detail.changeContact")}
                disabled={contactHook.contactUpdating}
                onPress={contactHook.openContactPicker}
              />
            </View>
            {contactHook.contactError ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
                {contactHook.contactError}
              </Text>
            ) : null}
          </KeyValue>
          <View style={{ height: spacing.sm }} />
          <KeyValue
            label={t("detail.client")}
            value={renderEntityValue(
              ticket.client_name,
              typeof ticket.client_logo_url === "string" ? ticket.client_logo_url : null,
              t("detail.client"),
            )}
          >
            {ticket.client_phone ? (
              <Pressable
                onPress={() => void Linking.openURL(`tel:${ticket.client_phone}`)}
                accessibilityRole="button"
                style={{ marginTop: spacing.xs, paddingVertical: spacing.xs }}
              >
                <Text style={{ ...typography.caption, color: colors.primary }}>
                  {t("detail.contactPhone")}: {ticket.client_phone}
                </Text>
              </Pressable>
            ) : null}
            {ticket.client_email ? (
              <Pressable
                onPress={() => void Linking.openURL(`mailto:${ticket.client_email}`)}
                accessibilityRole="button"
                style={{ marginTop: spacing.xs, paddingVertical: spacing.xs }}
              >
                <Text style={{ ...typography.caption, color: colors.primary }}>
                  {t("detail.contactEmail")}: {ticket.client_email}
                </Text>
              </Pressable>
            ) : null}
            {ticket.location_name ? (
              <Pressable
                onPress={() => {
                  const query = encodeURIComponent(ticket.location_name ?? "");
                  const url = Platform.OS === "ios"
                    ? `maps:0,0?q=${query}`
                    : `geo:0,0?q=${query}`;
                  void Linking.openURL(url);
                }}
                accessibilityRole="button"
                accessibilityLabel={t("detail.openInMaps")}
                style={{ marginTop: spacing.xs, paddingVertical: spacing.xs }}
              >
                <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("detail.location")}</Text>
                <Text style={{ ...typography.caption, color: colors.primary, marginTop: 2 }}>{ticket.location_name}</Text>
              </Pressable>
            ) : null}
          </KeyValue>
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.created")} value={formatDateTimeWithRelative(ticket.entered_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.updated")} value={formatDateTimeWithRelative(ticket.updated_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.due")} value={formatDateTimeWithRelative(getDueDateIso(ticket))} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.closed")} value={formatDateTimeWithRelative(ticket.closed_at)} />
          </TicketDetailsSection>
          <View style={{ height: spacing.sm }} />
          <TagsSection
            tags={tagsHook.tags}
            loading={tagsHook.tagsLoading}
            hidden={tagsHook.tagsHidden}
            error={tagsHook.tagsError}
            actionError={tagsHook.tagPickerOpen ? null : tagsHook.tagActionError}
            updating={tagsHook.tagUpdating}
            onAddPress={tagsHook.openTagPicker}
            initiallyCollapsed
          />
          <View style={{ height: spacing.sm }} />
          <DocumentsSection
            client={client}
            apiKey={session.accessToken}
            ticketId={ticketId}
            baseUrl={config.ok ? config.baseUrl : null}
            initiallyCollapsed
          />
          <View style={{ height: spacing.sm }} />
          <MaterialsSection
            client={client}
            apiKey={session.accessToken}
            ticketId={ticketId}
            initiallyCollapsed
          />
          <View style={{ height: spacing.sm }} />
          <AssetsSection
            client={client}
            apiKey={session.accessToken}
            ticketId={ticketId}
            initiallyCollapsed
          />
          <View style={{ height: spacing.sm }} />
          <TimeEntriesSection
            client={client}
            apiKey={session.accessToken}
            ticketId={ticketId}
            refreshKey={timeEntriesRefreshKey}
            meUserId={meUserId}
            onAddPress={() => { timeEntryHook.openTimeEntryModal(); }}
            initiallyCollapsed
          />
        </View>
      </ScrollView>

      <MoreActionsSheet
        visible={moreActionsOpen}
        onClose={() => setMoreActionsOpen(false)}
        baseUrl={config.ok ? config.baseUrl : null}
        ticketId={ticket.ticket_id}
        ticketNumber={ticket.ticket_number}
        isWatching={isWatching}
        watchUpdating={watchHook.watchUpdating}
        watchDisabled={!meUserId}
        onToggleWatch={() => { void watchHook.toggleWatch(); }}
      />

      <DueDateModal
        visible={dueDateHook.dueDateOpen}
        currentDueDateIso={getDueDateIso(ticket)}
        updating={dueDateHook.dueDateUpdating}
        error={dueDateHook.dueDateError}
        onSave={(iso, notificationSuppression) => void dueDateHook.submitDueDateIso(iso, notificationSuppression)}
        onClose={() => dueDateHook.setDueDateOpen(false)}
      />

      <TimeEntryModal
        visible={timeEntryHook.timeEntryOpen}
        date={timeEntryHook.timeEntryDate}
        onChangeDate={timeEntryHook.setTimeEntryDate}
        startTime={timeEntryHook.timeEntryStartTime}
        onChangeStartTime={timeEntryHook.setTimeEntryStartTime}
        endTime={timeEntryHook.timeEntryEndTime}
        onChangeEndTime={timeEntryHook.setTimeEntryEndTime}
        notes={timeEntryHook.timeEntryNotes}
        onChangeNotes={timeEntryHook.setTimeEntryNotes}
        serviceId={timeEntryHook.timeEntryServiceId}
        onChangeServiceId={timeEntryHook.setTimeEntryServiceId}
        client={client}
        apiKey={session?.accessToken ?? null}
        updating={timeEntryHook.timeEntryUpdating}
        error={timeEntryHook.timeEntryError}
        onClose={() => timeEntryHook.setTimeEntryOpen(false)}
        onSubmit={() => void timeEntryHook.submitTimeEntry()}
      />

      <PriorityPickerModal
        visible={priorityHook.priorityPickerOpen}
        loading={priorityHook.priorityOptionsLoading}
        error={priorityHook.priorityOptionsError}
        priorities={priorityHook.priorityOptions}
        currentPriorityId={ticket.priority_id ?? null}
        updating={priorityHook.priorityUpdating}
        updateError={priorityHook.priorityUpdateError}
        onApply={(id, notificationSuppression) => void priorityHook.submitPriority(id, notificationSuppression)}
        onClose={() => priorityHook.setPriorityPickerOpen(false)}
      />

      <StatusPickerModal
        visible={statusHook.statusPickerOpen}
        loading={statusHook.statusOptionsLoading}
        error={statusHook.statusOptionsError}
        statuses={statusHook.statusOptions}
        currentStatusId={ticket.status_id ?? null}
        updating={statusHook.statusUpdating}
        updateError={statusHook.statusUpdateError}
        onApply={(id, notificationSuppression) => void statusHook.submitStatus(id, notificationSuppression)}
        onClose={() => statusHook.setStatusPickerOpen(false)}
      />

      <AgentPickerModal
        visible={assignmentHook.agentPickerOpen}
        updating={assignmentHook.assignmentUpdating}
        updateError={assignmentHook.assignmentError}
        currentAssignedToId={ticket.assigned_to}
        currentAssignedToName={ticket.assigned_to_name}
        onApply={(userId, notificationSuppression) => {
          if (userId) void assignmentHook.assignToUser(userId, notificationSuppression);
          else void assignmentHook.unassign(notificationSuppression).then((updated) => {
            if (updated) assignmentHook.closeAgentPicker();
          });
        }}
        onClose={assignmentHook.closeAgentPicker}
        client={client}
        apiKey={session?.accessToken ?? ""}
        baseUrl={config.ok ? config.baseUrl : null}
      />

      <TagPickerModal
        visible={tagsHook.tagPickerOpen}
        updating={tagsHook.tagUpdating}
        updateError={tagsHook.tagActionError}
        appliedTagTexts={tagsHook.tags.map((tag) => tag.tag_text)}
        onApply={(tagTexts) => { void tagsHook.applyTags(tagTexts); }}
        onClose={tagsHook.closeTagPicker}
        client={client}
        apiKey={session?.accessToken ?? ""}
      />

      <ContactPickerModal
        visible={contactHook.contactPickerOpen}
        updating={contactHook.contactUpdating}
        updateError={contactHook.contactError}
        currentContactId={(ticket as Record<string, unknown>).contact_name_id as string | null | undefined}
        currentContactName={ticket.contact_name}
        clientId={(ticket as Record<string, unknown>).client_id as string | null | undefined}
        onApply={(contactNameId, notificationSuppression) => {
          if (contactNameId) void contactHook.selectContact(contactNameId, notificationSuppression);
          else void contactHook.removeContact(notificationSuppression);
        }}
        onClose={contactHook.closeContactPicker}
        client={client}
        apiKey={session?.accessToken ?? ""}
        baseUrl={config.ok ? config.baseUrl : null}
      />
    </>
  );
}
