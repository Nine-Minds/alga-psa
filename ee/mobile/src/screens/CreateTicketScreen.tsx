import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/types";
import { useTheme } from "../ui/ThemeContext";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { EntityPickerModal, type EntityPickerItem } from "../ui/components/EntityPickerModal";
import { createTicket, getTicketStatuses, getTicketPriorities, type TicketStatus, type TicketPriority } from "../api/tickets";
import { listBoards, listClients, listContacts, listClientLocations, type BoardListItem, type ClientListItem, type ContactListItem, type LocationListItem } from "../api/referenceData";
import { listUsers, getUserDisplayName, type UserListItem } from "../api/users";
import { getClientMetadataHeaders } from "../device/clientMetadata";
import { invalidateTicketsListCache } from "../cache/ticketsCache";

type Props = NativeStackScreenProps<RootStackParamList, "CreateTicket">;

type PickerField = "board" | "client" | "contact" | "location" | "status" | "priority" | "assignee" | null;

export function CreateTicketScreen({ navigation }: Props) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/create-ticket",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const apiKey = session?.accessToken ?? "";

  // --- Form state ---
  const [title, setTitle] = useState("");
  const [boardId, setBoardId] = useState<string | null>(null);
  const [boardName, setBoardName] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationName, setLocationName] = useState("");
  const [statusId, setStatusId] = useState<string | null>(null);
  const [statusName, setStatusName] = useState("");
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [priorityName, setPriorityName] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigneeName, setAssigneeName] = useState("");
  const [description, setDescription] = useState("");

  // --- Picker state ---
  const [activePicker, setActivePicker] = useState<PickerField>(null);
  const [pickerItems, setPickerItems] = useState<EntityPickerItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // --- Submit state ---
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // --- Reference data cache ---
  const boardsRef = useRef<BoardListItem[]>([]);
  const statusesRef = useRef<TicketStatus[]>([]);
  const prioritiesRef = useRef<TicketPriority[]>([]);
  const clientsRef = useRef<ClientListItem[]>([]);
  const contactsRef = useRef<ContactListItem[]>([]);
  const locationsRef = useRef<LocationListItem[]>([]);
  const usersRef = useRef<UserListItem[]>([]);

  // --- Fetch helpers ---
  const fetchBoards = useCallback(async () => {
    if (!client) return;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await listBoards(client, { apiKey });
      if (!res.ok) { setPickerError(t("create.errors.loadBoards")); return; }
      boardsRef.current = res.data.data;
      setPickerItems(res.data.data.map((b) => ({ id: b.board_id, label: b.board_name, subtitle: b.is_default ? t("create.defaultBoard") : null })));
    } catch { setPickerError(t("create.errors.loadBoards")); }
    finally { setPickerLoading(false); }
  }, [client, apiKey, t]);

  const fetchStatuses = useCallback(async (forBoardId: string) => {
    if (!client) return;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await getTicketStatuses(client, { apiKey, board_id: forBoardId });
      if (!res.ok) { setPickerError(t("create.errors.loadStatuses")); return; }
      statusesRef.current = res.data.data;
      setPickerItems(res.data.data.map((s) => ({ id: s.status_id, label: s.name, subtitle: s.is_closed ? t("statusPicker.closedLabel") : t("statusPicker.openLabel") })));
    } catch { setPickerError(t("create.errors.loadStatuses")); }
    finally { setPickerLoading(false); }
  }, [client, apiKey, t]);

  const fetchPriorities = useCallback(async () => {
    if (!client) return;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await getTicketPriorities(client, { apiKey });
      if (!res.ok) { setPickerError(t("create.errors.loadPriorities")); return; }
      prioritiesRef.current = res.data.data;
      setPickerItems(res.data.data.map((p) => ({ id: p.priority_id, label: p.priority_name })));
    } catch { setPickerError(t("create.errors.loadPriorities")); }
    finally { setPickerLoading(false); }
  }, [client, apiKey, t]);

  const fetchClients = useCallback(async (query?: string) => {
    if (!client) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await listClients(client, { apiKey, search: query || undefined, limit: 50, signal: controller.signal });
      if (!res.ok) { setPickerError(t("create.errors.loadClients")); return; }
      clientsRef.current = res.data.data;
      const base = config.ok ? config.baseUrl : null;
      setPickerItems(res.data.data.map((c) => ({ id: c.client_id, label: c.client_name, subtitle: c.email, imageUri: c.logoUrl && base ? `${base}${c.logoUrl}` : null })));
    } catch { if (!controller.signal.aborted) setPickerError(t("create.errors.loadClients")); }
    finally { if (!controller.signal.aborted) setPickerLoading(false); }
  }, [client, apiKey, t]);

  const fetchContacts = useCallback(async (query?: string) => {
    if (!client || !clientId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await listContacts(client, { apiKey, clientId, search: query || undefined, limit: 50, signal: controller.signal });
      if (!res.ok) { setPickerError(t("create.errors.loadContacts")); return; }
      // Deduplicate contacts (API may return joined rows with duplicate IDs)
      const seen = new Set<string>();
      const unique = res.data.data.filter((c) => {
        if (seen.has(c.contact_name_id)) return false;
        seen.add(c.contact_name_id);
        return true;
      });
      contactsRef.current = unique;
      const base = config.ok ? config.baseUrl : null;
      setPickerItems(unique.map((c) => ({ id: c.contact_name_id, label: c.full_name, subtitle: c.email, imageUri: c.avatarUrl && base ? `${base}${c.avatarUrl}` : null })));
    } catch { if (!controller.signal.aborted) setPickerError(t("create.errors.loadContacts")); }
    finally { if (!controller.signal.aborted) setPickerLoading(false); }
  }, [client, apiKey, clientId, t]);

  const fetchLocations = useCallback(async () => {
    if (!client || !clientId) return;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await listClientLocations(client, { apiKey, clientId });
      if (!res.ok) { setPickerError(t("create.errors.loadLocations")); return; }
      locationsRef.current = res.data.data;
      setPickerItems(res.data.data.map((l) => {
        const label = l.location_name || l.address_line1 || "Unnamed location";
        const parts = [l.address_line1, l.city, l.state_province].filter(Boolean);
        const subtitle = l.location_name && parts.length > 0 ? parts.join(", ") : null;
        return { id: l.location_id, label, subtitle };
      }));
    } catch { setPickerError(t("create.errors.loadLocations")); }
    finally { setPickerLoading(false); }
  }, [client, apiKey, clientId, t]);

  const fetchUsers = useCallback(async (query?: string) => {
    if (!client) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPickerLoading(true);
    setPickerError(null);
    try {
      const res = await listUsers(client, { apiKey, search: query || undefined, limit: 50, signal: controller.signal });
      if (!res.ok) { setPickerError(t("create.errors.loadAgents")); return; }
      usersRef.current = res.data.data;
      const base = config.ok ? config.baseUrl : null;
      setPickerItems(res.data.data.map((u) => ({ id: u.user_id, label: getUserDisplayName(u), subtitle: u.email, imageUri: u.avatarUrl && base ? `${base}${u.avatarUrl}` : null })));
    } catch { if (!controller.signal.aborted) setPickerError(t("create.errors.loadAgents")); }
    finally { if (!controller.signal.aborted) setPickerLoading(false); }
  }, [client, apiKey, t]);

  // --- Open picker ---
  const openPicker = useCallback((field: PickerField) => {
    setPickerItems([]);
    setPickerError(null);
    setActivePicker(field);
    switch (field) {
      case "board": void fetchBoards(); break;
      case "client": void fetchClients(); break;
      case "contact": void fetchContacts(); break;
      case "location": void fetchLocations(); break;
      case "status": if (boardId) void fetchStatuses(boardId); break;
      case "priority": void fetchPriorities(); break;
      case "assignee": void fetchUsers(); break;
    }
  }, [fetchBoards, fetchClients, fetchContacts, fetchLocations, fetchStatuses, fetchPriorities, fetchUsers, boardId]);

  // --- Auto-select default board on mount ---
  useEffect(() => {
    if (!client || boardId) return;
    let canceled = false;
    void (async () => {
      const res = await listBoards(client, { apiKey });
      if (canceled || !res.ok) return;
      boardsRef.current = res.data.data;
      const defaultBoard = res.data.data.find((b) => b.is_default);
      if (defaultBoard) {
        setBoardId(defaultBoard.board_id);
        setBoardName(defaultBoard.board_name);
      }
    })();
    return () => { canceled = true; };
  }, [client, apiKey, boardId]);

  // --- Auto-select defaults when board changes ---
  useEffect(() => {
    if (!boardId || !client) return;
    // Reset status when board changes
    setStatusId(null);
    setStatusName("");
    // Auto-fill default assignee from board
    const selectedBoard = boardsRef.current.find((b) => b.board_id === boardId);
    if (selectedBoard?.default_assigned_to) {
      const defaultUserId = selectedBoard.default_assigned_to;
      // Fetch users to resolve the assignee name
      void (async () => {
        const usersRes = await listUsers(client, { apiKey, limit: 100 });
        if (usersRes.ok) {
          const match = usersRes.data.data.find((u) => u.user_id === defaultUserId);
          setAssigneeId(defaultUserId);
          setAssigneeName(match ? getUserDisplayName(match) : "");
        }
      })();
    } else {
      setAssigneeId(null);
      setAssigneeName("");
    }
    // Fetch statuses and auto-select first open one
    void (async () => {
      const res = await getTicketStatuses(client, { apiKey, board_id: boardId });
      if (res.ok) {
        statusesRef.current = res.data.data;
        const defaultStatus = res.data.data.find((s) => !s.is_closed);
        if (defaultStatus) {
          setStatusId(defaultStatus.status_id);
          setStatusName(defaultStatus.name);
        }
      }
    })();
  }, [boardId, client, apiKey]);

  // Reset contact/location when client changes
  useEffect(() => {
    setContactId(null);
    setContactName("");
    setLocationId(null);
    setLocationName("");
  }, [clientId]);

  // --- Picker callbacks ---
  const handlePickerSelect = useCallback((id: string, label: string) => {
    switch (activePicker) {
      case "board":
        setBoardId(id);
        setBoardName(label);
        break;
      case "client":
        setClientId(id);
        setClientName(label);
        break;
      case "contact":
        setContactId(id);
        setContactName(label);
        break;
      case "location":
        setLocationId(id);
        setLocationName(label);
        break;
      case "status":
        setStatusId(id);
        setStatusName(label);
        break;
      case "priority":
        setPriorityId(id);
        setPriorityName(label);
        break;
      case "assignee":
        setAssigneeId(id);
        setAssigneeName(label);
        break;
    }
    setActivePicker(null);
  }, [activePicker]);

  const handlePickerSearch = useCallback((query: string) => {
    switch (activePicker) {
      case "client": void fetchClients(query); break;
      case "contact": void fetchContacts(query); break;
      case "assignee": void fetchUsers(query); break;
    }
  }, [activePicker, fetchClients, fetchContacts, fetchUsers]);

  // --- Validation ---
  const canSubmit = title.trim().length > 0 && boardId && clientId && statusId && priorityId;

  // --- Submit ---
  const handleSubmit = async () => {
    if (!client || !session || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      const res = await createTicket(client, {
        apiKey: session.accessToken,
        title: title.trim(),
        board_id: boardId!,
        client_id: clientId!,
        status_id: statusId!,
        priority_id: priorityId!,
        ...(contactId ? { contact_name_id: contactId } : {}),
        ...(locationId ? { location_id: locationId } : {}),
        ...(assigneeId ? { assigned_to: assigneeId } : {}),
        ...(description.trim() ? { attributes: { description: description.trim() } } : {}),
        auditHeaders,
      });
      if (!res.ok) {
        if (res.error.kind === "permission") {
          setSubmitError(t("create.errors.permission"));
        } else if (res.error.kind === "validation") {
          setSubmitError(t("create.errors.validation"));
        } else {
          setSubmitError(t("create.errors.generic"));
        }
        return;
      }
      invalidateTicketsListCache();
      // Navigate to the new ticket
      const newTicketId = res.data.data.ticket_id;
      navigation.replace("TicketDetail", { ticketId: newTicketId });
    } finally {
      setSubmitting(false);
    }
  };

  // --- Picker config ---
  const pickerConfig: Record<string, { title: string; placeholder?: string; searchable: boolean; empty: string; selectedId: string | null }> = {
    board: { title: t("create.selectBoard"), searchable: false, empty: t("create.noBoards"), selectedId: boardId },
    client: { title: t("create.selectClient"), placeholder: t("create.searchClients"), searchable: true, empty: t("create.noClients"), selectedId: clientId },
    contact: { title: t("create.selectContact"), placeholder: t("create.searchContacts"), searchable: true, empty: t("create.noContacts"), selectedId: contactId },
    location: { title: t("create.selectLocation"), searchable: false, empty: t("create.noLocations"), selectedId: locationId },
    status: { title: t("create.selectStatus"), searchable: false, empty: t("create.noStatuses"), selectedId: statusId },
    priority: { title: t("create.selectPriority"), searchable: false, empty: t("create.noPriorities"), selectedId: priorityId },
    assignee: { title: t("create.selectAssignee"), placeholder: t("create.searchAgents"), searchable: true, empty: t("create.noAgents"), selectedId: assigneeId },
  };

  const currentPicker = activePicker ? pickerConfig[activePicker] : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("create.titleLabel")} *</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t("create.titlePlaceholder")}
          placeholderTextColor={colors.textSecondary}
          maxLength={255}
          autoFocus
          style={{
            ...typography.body,
            color: colors.text,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.card,
            marginTop: spacing.xs,
          }}
        />

        {/* Board */}
        <FieldSelector
          label={t("create.board")}
          required
          value={boardName}
          placeholder={t("create.selectBoard")}
          onPress={() => openPicker("board")}
          colors={colors}
          spacing={spacing}
          typography={typography}
        />

        {/* Client */}
        <FieldSelector
          label={t("create.client")}
          required
          value={clientName}
          placeholder={t("create.selectClient")}
          onPress={() => openPicker("client")}
          colors={colors}
          spacing={spacing}
          typography={typography}
        />

        {/* Contact (optional, requires client) */}
        {clientId ? (
          <FieldSelector
            label={t("create.contact")}
            value={contactName}
            placeholder={t("create.selectContact")}
            onPress={() => openPicker("contact")}
            onClear={contactId ? () => { setContactId(null); setContactName(""); } : undefined}
            colors={colors}
            spacing={spacing}
            typography={typography}
          />
        ) : null}

        {/* Location (optional, requires client) */}
        {clientId ? (
          <FieldSelector
            label={t("create.location")}
            value={locationName}
            placeholder={t("create.selectLocation")}
            onPress={() => openPicker("location")}
            onClear={locationId ? () => { setLocationId(null); setLocationName(""); } : undefined}
            colors={colors}
            spacing={spacing}
            typography={typography}
          />
        ) : null}

        {/* Status (requires board) */}
        {boardId ? (
          <FieldSelector
            label={t("create.status")}
            required
            value={statusName}
            placeholder={t("create.selectStatus")}
            onPress={() => openPicker("status")}
            colors={colors}
            spacing={spacing}
            typography={typography}
          />
        ) : null}

        {/* Priority */}
        <FieldSelector
          label={t("create.priority")}
          required
          value={priorityName}
          placeholder={t("create.selectPriority")}
          onPress={() => openPicker("priority")}
          colors={colors}
          spacing={spacing}
          typography={typography}
        />

        {/* Assignee (optional) */}
        <FieldSelector
          label={t("create.assignee")}
          value={assigneeName}
          placeholder={t("create.selectAssignee")}
          onPress={() => openPicker("assignee")}
          onClear={assigneeId ? () => { setAssigneeId(null); setAssigneeName(""); } : undefined}
          colors={colors}
          spacing={spacing}
          typography={typography}
        />

        {/* Description (optional) */}
        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg }}>{t("create.description")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t("create.descriptionPlaceholder")}
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={{
            ...typography.body,
            color: colors.text,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.card,
            marginTop: spacing.xs,
            minHeight: 100,
          }}
        />

        {/* Errors */}
        {submitError ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {submitError}
          </Text>
        ) : null}

        {/* Submit */}
        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton
            onPress={() => { void handleSubmit(); }}
            disabled={!canSubmit || submitting}
            accessibilityLabel={t("create.submit")}
          >
            {submitting ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <ActivityIndicator size="small" color={colors.textInverse} />
                <Text style={{ ...typography.body, color: colors.textInverse, marginLeft: spacing.sm }}>{t("create.submitting")}</Text>
              </View>
            ) : (
              t("create.submit")
            )}
          </PrimaryButton>
        </View>
      </ScrollView>

      {/* Entity Picker Modal */}
      {currentPicker ? (
        <EntityPickerModal
          visible={activePicker !== null}
          title={currentPicker.title}
          searchPlaceholder={currentPicker.placeholder}
          emptyLabel={currentPicker.empty}
          items={pickerItems}
          loading={pickerLoading}
          error={pickerError}
          searchable={currentPicker.searchable}
          selectedId={currentPicker.selectedId}
          authToken={apiKey}
          onSearch={currentPicker.searchable ? handlePickerSearch : undefined}
          onSelect={handlePickerSelect}
          onClose={() => setActivePicker(null)}
        />
      ) : null}
    </View>
  );
}

// --- Field Selector Component ---

function FieldSelector({
  label,
  required,
  value,
  placeholder,
  onPress,
  onClear,
  colors,
  spacing,
  typography,
}: {
  label: string;
  required?: boolean;
  value: string;
  placeholder: string;
  onPress: () => void;
  onClear?: () => void;
  colors: Record<string, any>;
  spacing: Record<string, number>;
  typography: Record<string, any>;
}) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={{ ...typography.caption, color: colors.textSecondary }}>
        {label}{required ? " *" : ""}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.xs }}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.card,
            opacity: pressed ? 0.95 : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          })}
        >
          <Text style={{ ...typography.body, color: value ? colors.text : colors.textSecondary, flex: 1 }}>
            {value || placeholder}
          </Text>
          <Feather name="chevron-down" size={16} color={colors.textSecondary} />
        </Pressable>
        {onClear ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel="Clear"
            style={{ padding: spacing.xs, marginLeft: spacing.xs }}
          >
            <Feather name="x" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
