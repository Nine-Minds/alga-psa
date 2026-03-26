import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { ErrorState, LoadingState } from "../ui/states";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useNetworkStatus } from "../network/useNetworkStatus";
import { isOffline as isOfflineStatus } from "../network/isOffline";
import { useToast } from "../ui/toast/ToastProvider";
import { Badge } from "../ui/components/Badge";
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
import { useTicketQa } from "../features/ticketDetail/hooks/useTicketQa";

// Components
import { ActionChip } from "../features/ticketDetail/components/ActionChip";
import { KeyValue } from "../features/ticketDetail/components/KeyValue";
import { TicketActions } from "../features/ticketDetail/components/TicketActions";
import { DueDateModal } from "../features/ticketDetail/components/DueDateModal";
import { TimeEntryModal } from "../features/ticketDetail/components/TimeEntryModal";
import { PriorityPickerModal } from "../features/ticketDetail/components/PriorityPickerModal";
import { StatusPickerModal } from "../features/ticketDetail/components/StatusPickerModal";
import { AgentPickerModal } from "../features/ticketDetail/components/AgentPickerModal";

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

  const imageAuth = useMemo(() => {
    if (!config.ok || !session) return undefined;
    return { baseUrl: config.baseUrl, apiKey: session.accessToken };
  }, [config, session]);

  const deps = { client, session, ticketId, showToast, t };

  // --- Hooks ---
  const ticketData = useTicketData(deps);
  const { ticket, initialLoading, error, comments, commentsError, refreshing, refresh, fetchTicket, fetchComments, setComments } = ticketData;

  const commentDraftHook = useCommentDraft({ ...deps, isOffline, fetchTicket, fetchComments, setComments });
  const descEditor = useDescriptionEditor({ ...deps, ticket, setTicket: ticketData.setTicket });
  const boardId = ticket?.board_id as string | undefined;
  const statusHook = useTicketStatus({ ...deps, fetchTicket, boardId });
  const priorityHook = useTicketPriority({ ...deps, fetchTicket });
  const dueDateHook = useTicketDueDate({ ...deps, ticket, fetchTicket });
  const watchHook = useTicketWatch({ ...deps, ticket, fetchTicket });
  const timeEntryHook = useTimeEntry(deps);
  const assignmentHook = useTicketAssignment({ ...deps, fetchTicket });
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

  // --- Scroll helpers ---
  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

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
  const isAssignedToMe = Boolean(meUserId && ticket.assigned_to && ticket.assigned_to === meUserId);
  const renderEntityValue = useCallback((name: string | null | undefined, imageUri: string | null | undefined, accessibilityLabel: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Avatar
        name={name ?? undefined}
        imageUri={imageUri ?? undefined}
        authToken={session.accessToken}
        size="sm"
        accessibilityLabel={accessibilityLabel}
      />
      <Text style={{ ...typography.body, color: colors.text, flexShrink: 1 }}>
        {stringOrDash(name)}
      </Text>
    </View>
  ), [colors.text, session.accessToken, spacing.sm, typography.body]);

  // --- Render ---
  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
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
                onSubmitEditing={() => void titleHook.saveTitle()}
              />
              <Pressable
                onPress={titleHook.cancelTitleEditing}
                disabled={titleHook.titleSaving}
                accessibilityRole="button"
                accessibilityLabel={t("common:cancel")}
                style={{ padding: spacing.xs, opacity: titleHook.titleSaving ? 0.4 : 1 }}
              >
                <Feather name="x" size={22} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => void titleHook.saveTitle()}
                disabled={titleHook.titleSaving}
                accessibilityRole="button"
                accessibilityLabel={t("common:save")}
                style={{ padding: spacing.xs, opacity: titleHook.titleSaving ? 0.4 : 1 }}
              >
                {titleHook.titleSaving ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="check" size={22} color={colors.primary} />
                )}
              </Pressable>
            </View>
            {titleHook.titleError ? (
              <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.xs }}>
                {titleHook.titleError}
              </Text>
            ) : null}
          </View>
        ) : (
          <Pressable onPress={titleHook.startTitleEditing} accessibilityRole="button" accessibilityLabel={t("detail.editTitle")}>
            <Text accessibilityRole="header" style={{ ...typography.title, marginTop: 2, color: colors.text }}>
              {ticket.title}
            </Text>
          </Pressable>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md }}>
          <Badge label={statusLabel} tone={ticket.status_is_closed ? "neutral" : "info"} />
          {ticket.priority_name ? <View style={{ width: spacing.sm }} /> : null}
          {ticket.priority_name ? <Badge label={ticket.priority_name} tone="warning" /> : null}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm, gap: spacing.sm }}>
          <ActionChip
            label={t("detail.changeStatus")}
            onPress={() => { void statusHook.openStatusPicker(); }}
          />
          <ActionChip
            label={t("detail.changePriority")}
            onPress={() => { void priorityHook.openPriorityPicker(); }}
          />
          <ActionChip
            label={t("detail.dueDate")}
            onPress={() => {
              dueDateHook.setDueDateDraft(isoToDateInput(getDueDateIso(ticket)) ?? "");
              dueDateHook.setDueDateOpen(true);
            }}
          />
          <ActionChip
            label={isWatching ? t("detail.unwatch") : t("detail.watch")}
            loading={watchHook.watchUpdating}
            disabled={!meUserId}
            onPress={() => { void watchHook.toggleWatch(); }}
          />
          <ActionChip
            label={t("detail.addTime")}
            onPress={() => { timeEntryHook.openTimeEntryModal(); }}
          />
          <ActionChip
            label={
              assignmentHook.assignmentUpdating && assignmentHook.assignmentAction === "assign"
                ? t("detail.assigning")
                : isAssignedToMe
                  ? t("detail.assignedToMe")
                  : t("detail.assignToMe")
            }
            loading={assignmentHook.assignmentUpdating && assignmentHook.assignmentAction === "assign"}
            disabled={assignmentHook.assignmentUpdating || isAssignedToMe}
            onPress={() => { void assignmentHook.assignToMe(); }}
          />
          <ActionChip
            label={t("detail.reassign")}
            disabled={assignmentHook.assignmentUpdating}
            onPress={assignmentHook.openAgentPicker}
          />
          {ticket.assigned_to_name ? (
            <ActionChip
              label={assignmentHook.assignmentUpdating && assignmentHook.assignmentAction === "unassign" ? t("detail.unassigning") : t("detail.unassign")}
              loading={assignmentHook.assignmentUpdating && assignmentHook.assignmentAction === "unassign"}
              disabled={assignmentHook.assignmentUpdating}
              onPress={() => { void assignmentHook.unassign(); }}
            />
          ) : null}
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

        <TicketActions
          baseUrl={config.ok ? config.baseUrl : null}
          ticketId={ticket.ticket_id}
          ticketNumber={ticket.ticket_number}
        />

        {ticket.assigned_to_name ? (
          <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.text }}>
            {t("detail.assignedTo", { name: ticket.assigned_to_name })}
          </Text>
        ) : (
          <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.textSecondary }}>
            {t("detail.unassigned")}
          </Text>
        )}

        <View style={{ marginTop: spacing.lg }}>
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
            onSave={() => void descEditor.saveDescription()}
            onDraftChange={(nextContent, nextPlainText) => {
              descEditor.setDescriptionDraft(nextContent);
              descEditor.setDescriptionPlainText(nextPlainText);
            }}
          />
          <View style={{ height: spacing.sm }} />
          <DocumentsSection
            client={client}
            apiKey={session.accessToken}
            ticketId={ticketId}
            baseUrl={config.ok ? config.baseUrl : null}
          />
          <View style={{ height: spacing.sm }} />
          <MaterialsSection
            client={client}
            apiKey={session.accessToken}
            ticketId={ticketId}
          />
          <View style={{ height: spacing.sm }} />
          <CommentsSection
            comments={comments}
            visibleCount={commentDraftHook.commentsVisibleCount}
            onLoadMore={() => commentDraftHook.setCommentsVisibleCount((c) => c + 20)}
            onJumpToLatest={scrollToLatest}
            onJumpToTop={scrollToTop}
            error={commentsError}
            onLinkPress={qaHook.handleRichTextLinkPress}
            imageAuth={imageAuth}
            baseUrl={config.ok ? config.baseUrl : null}
            ticketId={ticketId}
            onCommentUpdated={() => void fetchComments()}
          />
          <View style={{ height: spacing.sm }} />
          <CommentComposer
            draftContent={commentDraftHook.commentDraft}
            draftPlainText={commentDraftHook.commentDraftPlainText}
            isInternal={commentDraftHook.commentIsInternal}
            onChangeIsInternal={commentDraftHook.setCommentIsInternal}
            onSend={() => void commentDraftHook.sendComment()}
            sending={commentDraftHook.commentSending}
            offline={isOffline}
            error={commentDraftHook.commentSendError}
            editorRef={commentDraftHook.commentEditorRef}
            onDraftChange={(nextContent, nextPlainText) => {
              commentDraftHook.setCommentDraft(nextContent);
              commentDraftHook.setCommentDraftPlainText(nextPlainText);
            }}
          />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.created")} value={formatDateTimeWithRelative(ticket.entered_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.updated")} value={formatDateTimeWithRelative(ticket.updated_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.due")} value={formatDateTimeWithRelative(getDueDateIso(ticket))} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.closed")} value={formatDateTimeWithRelative(ticket.closed_at)} />
          <View style={{ height: spacing.sm }} />
          <KeyValue label={t("detail.ticketId")} value={ticket.ticket_id} />
        </View>
      </ScrollView>

      <DueDateModal
        visible={dueDateHook.dueDateOpen}
        currentDueDateIso={getDueDateIso(ticket)}
        updating={dueDateHook.dueDateUpdating}
        error={dueDateHook.dueDateError}
        onClear={() => void dueDateHook.submitDueDateIso(null)}
        onSave={(iso) => void dueDateHook.submitDueDateIso(iso)}
        onSetInDays={(days) => void dueDateHook.setDueDateInDays(days)}
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
        onSelect={(id) => void priorityHook.submitPriority(id)}
        onClose={() => priorityHook.setPriorityPickerOpen(false)}
      />

      <StatusPickerModal
        visible={statusHook.statusPickerOpen}
        loading={statusHook.statusOptionsLoading}
        error={statusHook.statusOptionsError}
        statuses={statusHook.statusOptions}
        currentStatusId={statusHook.pendingStatusId ?? ticket.status_id ?? null}
        updating={statusHook.statusUpdating}
        updateError={statusHook.statusUpdateError}
        onSelect={(id) => void statusHook.submitStatus(id)}
        onClose={() => statusHook.setStatusPickerOpen(false)}
      />

      <AgentPickerModal
        visible={assignmentHook.agentPickerOpen}
        updating={assignmentHook.assignmentUpdating}
        updateError={assignmentHook.assignmentError}
        currentAssignedToName={ticket.assigned_to_name}
        onSelect={(userId) => { void assignmentHook.assignToUser(userId); }}
        onUnassign={() => { void assignmentHook.unassign(); assignmentHook.closeAgentPicker(); }}
        onClose={assignmentHook.closeAgentPicker}
        client={client}
        apiKey={session?.accessToken ?? ""}
        baseUrl={config.ok ? config.baseUrl : null}
      />
    </>
  );
}
