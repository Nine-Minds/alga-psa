import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../api";
import { createTicketFromAsset } from "../../api/assets";
import { listBoards, type BoardListItem } from "../../api/referenceData";
import { listPriorities, type MobilePriority } from "../../api/priorities";
import { getTicketStatuses, type TicketStatus } from "../../api/tickets";
import { useTheme } from "../../ui/ThemeContext";
import type { Theme } from "../../ui/themes";
import { useToast } from "../../ui/toast/ToastProvider";
import { PrimaryButton, TextInput } from "../../ui/components";
import { Select, type SelectOption } from "../../ui/components/Select";

type PickerKind = "board" | "status" | "priority" | null;

export function CreateTicketModal({
  visible,
  client,
  apiKey,
  assetId,
  clientId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  assetId: string;
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const { showToast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [boards, setBoards] = useState<BoardListItem[]>([]);
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [priorities, setPriorities] = useState<MobilePriority[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle("");
    setDescription("");
    setBoardId(null);
    setStatusId(null);
    setPriorityId(null);
    setStatuses([]);
    setPicker(null);
    setSubmitting(false);
    setError(null);
    if (!client || !apiKey) return;
    let canceled = false;
    void (async () => {
      const [boardsResult, prioritiesResult] = await Promise.all([
        listBoards(client, { apiKey }),
        listPriorities(client, { apiKey, itemType: "ticket" }),
      ]);
      if (canceled) return;
      if (boardsResult.ok) setBoards(boardsResult.data.data);
      if (prioritiesResult.ok) setPriorities(prioritiesResult.data.data);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, visible]);

  // Ticket statuses are board-scoped, so (re)load them whenever the board changes.
  useEffect(() => {
    if (!visible || !client || !apiKey || !boardId) return;
    let canceled = false;
    void (async () => {
      const result = await getTicketStatuses(client, { apiKey, board_id: boardId });
      if (canceled) return;
      if (result.ok) setStatuses(result.data.data);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, boardId, client, visible]);

  const boardOptions = useMemo<SelectOption<string>[]>(
    () => boards.map((board) => ({ label: board.board_name, value: board.board_id })),
    [boards],
  );
  const statusOptions = useMemo<SelectOption<string>[]>(
    () => statuses.map((status) => ({ label: status.name, value: status.status_id })),
    [statuses],
  );
  const priorityOptions = useMemo<SelectOption<string>[]>(
    () => priorities.map((priority) => ({ label: priority.priority_name, value: priority.priority_id })),
    [priorities],
  );

  const boardName = boards.find((board) => board.board_id === boardId)?.board_name ?? null;
  const statusName = statuses.find((status) => status.status_id === statusId)?.name ?? null;
  const priorityName = priorities.find((priority) => priority.priority_id === priorityId)?.priority_name ?? null;

  const canSubmit =
    !submitting && title.trim().length > 0 && boardId !== null && statusId !== null && priorityId !== null;

  const handleSubmit = useCallback(async () => {
    if (!client || !apiKey || !boardId || !statusId || !priorityId || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    const result = await createTicketFromAsset(client, {
      apiKey,
      data: {
        title: title.trim(),
        description: description.trim() || undefined,
        board_id: boardId,
        status_id: statusId,
        priority_id: priorityId,
        asset_id: assetId,
        client_id: clientId,
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(t("createTicket.error", "Couldn't create the ticket. Try again."));
      return;
    }
    const ticketNumber = result.data.data?.ticket_number;
    showToast({
      tone: "success",
      message: ticketNumber
        ? t("createTicket.success", "Ticket {{number}} created", { number: ticketNumber })
        : t("createTicket.successNoNumber", "Ticket created"),
    });
    onCreated();
    onClose();
  }, [apiKey, assetId, boardId, client, clientId, description, onClose, onCreated, priorityId, showToast, statusId, t, title]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("createTicket.title", "Create a ticket")}
        </Text>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("createTicket.titleField", "Title")}
            value={title}
            onChangeText={setTitle}
            disabled={submitting}
            accessibilityLabel="asset-detail-create-ticket-title"
          />
        </View>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("createTicket.description", "Description")}
            value={description}
            onChangeText={setDescription}
            multiline
            minHeight={90}
            disabled={submitting}
            accessibilityLabel="asset-detail-create-ticket-description"
          />
        </View>

        <PickerField
          theme={theme}
          testID="asset-detail-create-ticket-board"
          label={t("createTicket.board", "Board")}
          value={boardName}
          placeholder={t("createTicket.selectBoard", "Select a board")}
          disabled={submitting}
          onPress={() => setPicker("board")}
        />

        <PickerField
          theme={theme}
          testID="asset-detail-create-ticket-status"
          label={t("createTicket.status", "Status")}
          value={statusName}
          placeholder={
            boardId
              ? t("createTicket.selectStatus", "Select a status")
              : t("createTicket.selectStatusAfterBoard", "Pick a board first")
          }
          disabled={submitting || !boardId}
          onPress={() => setPicker("status")}
        />

        <PickerField
          theme={theme}
          testID="asset-detail-create-ticket-priority"
          label={t("createTicket.priority", "Priority")}
          value={priorityName}
          placeholder={t("createTicket.selectPriority", "Select a priority")}
          disabled={submitting}
          onPress={() => setPicker("priority")}
        />

        {error ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>
            {error}
          </Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <PrimaryButton
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            accessibilityLabel="asset-detail-create-ticket-submit"
          >
            {t("createTicket.submit", "Create ticket")}
          </PrimaryButton>
          <Text
            onPress={onClose}
            testID="asset-detail-create-ticket-cancel"
            style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.xs }}
          >
            {t("common.cancel", "Cancel")}
          </Text>
        </View>
      </ScrollView>

      <Select
        visible={picker === "board"}
        value={boardId}
        options={boardOptions}
        title={t("createTicket.board", "Board")}
        onSelect={(value) => {
          setBoardId(value);
          setStatusId(null);
        }}
        onClose={() => setPicker(null)}
      />
      <Select
        visible={picker === "status"}
        value={statusId}
        options={statusOptions}
        title={t("createTicket.status", "Status")}
        onSelect={(value) => setStatusId(value)}
        onClose={() => setPicker(null)}
      />
      <Select
        visible={picker === "priority"}
        value={priorityId}
        options={priorityOptions}
        title={t("createTicket.priority", "Priority")}
        onSelect={(value) => setPriorityId(value)}
        onClose={() => setPicker(null)}
      />
    </Modal>
  );
}

function PickerField({
  theme,
  testID,
  label,
  value,
  placeholder,
  disabled,
  onPress,
}: {
  theme: Theme;
  testID: string;
  label: string;
  value: string | null;
  placeholder: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ marginTop: theme.spacing.lg }}>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
        {label}
      </Text>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={value ?? placeholder}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: disabled ? theme.colors.borderLight : theme.colors.card,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Text style={{ ...theme.typography.body, color: value ? theme.colors.text : theme.colors.placeholder }}>
          {value ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={18} color={theme.colors.textSecondary} />
      </Pressable>
    </View>
  );
}
