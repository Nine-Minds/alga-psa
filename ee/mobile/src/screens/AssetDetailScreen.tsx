import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { Badge, Card, PrimaryButton, Separator, TextInput } from "../ui/components";
import { ErrorState, LoadingState } from "../ui/states";
import { formatDateShort } from "../ui/formatters/dateTime";
import { useToast } from "../ui/toast/ToastProvider";
import {
  getAsset,
  getAssetHistory,
  getAssetMaintenance,
  getAssetNotes,
  getAssetSoftware,
  getAssetTickets,
  recordAssetMaintenance,
  saveAssetNotes,
  type AssetDetail,
  type AssetSoftwareItem,
  type AssetTicketRow,
  type AssetWarrantyStatus,
  type MaintenanceHistoryItem,
  type MaintenanceSchedule,
} from "../api/assets";
import { appendNoteBlock, blockDataToText } from "../features/assets/blockNote";
import { useInventoryApi } from "../features/inventory/hooks/useInventoryApi";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { LinkTicketModal } from "../features/assets/LinkTicketModal";
import { CreateTicketModal } from "../features/assets/CreateTicketModal";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "AssetDetail">;

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function warrantyBadge(
  status: AssetWarrantyStatus | undefined,
  t: (key: string, fallback: string) => string,
): { label: string; tone: BadgeTone } {
  switch (status) {
    case "active":
      return { label: t("warranty.active", "Under warranty"), tone: "success" };
    case "expiring_soon":
      return { label: t("warranty.expiringSoon", "Warranty expiring"), tone: "warning" };
    case "expired":
      return { label: t("warranty.expired", "Out of warranty"), tone: "danger" };
    default:
      return { label: t("warranty.unknown", "Warranty unknown"), tone: "neutral" };
  }
}

function maintenanceDueBadge(
  nextMaintenance: string | null | undefined,
  t: (key: string, fallback: string) => string,
): { label: string; tone: BadgeTone } | null {
  if (!nextMaintenance) return null;
  const due = new Date(nextMaintenance).getTime();
  if (Number.isNaN(due)) return null;
  const now = Date.now();
  if (due < now) return { label: t("maintenance.overdue", "Overdue"), tone: "warning" };
  if (due - now <= SEVEN_DAYS_MS) return { label: t("maintenance.dueSoon", "Due soon"), tone: "warning" };
  return null;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: theme.spacing.xs }}>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.text, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

function SectionTitle({ theme, children }: { theme: Theme; children: string }) {
  return (
    <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600", marginBottom: theme.spacing.sm }}>
      {children}
    </Text>
  );
}

function EmptyLine({ theme, children }: { theme: Theme; children: string }) {
  return <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>{children}</Text>;
}

export function AssetDetailScreen({ route, navigation }: Props) {
  const { assetId, assetName } = route.params;
  const theme = useTheme();
  const { t } = useTranslation("assets");
  const { client, apiKey } = useInventoryApi();
  const { showToast } = useToast();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceSchedule[]>([]);
  const [history, setHistory] = useState<MaintenanceHistoryItem[]>([]);
  const [tickets, setTickets] = useState<AssetTicketRow[]>([]);
  const [software, setSoftware] = useState<AssetSoftwareItem[]>([]);
  const [notesBlockData, setNotesBlockData] = useState<unknown | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [recordSchedule, setRecordSchedule] = useState<MaintenanceSchedule | null>(null);
  const [recordNote, setRecordNote] = useState("");
  const [recording, setRecording] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const [assetResult, maintResult, historyResult, ticketsResult, softwareResult, notesResult] = await Promise.all([
      getAsset(client, { apiKey, assetId, signal: controller.signal }),
      getAssetMaintenance(client, { apiKey, assetId, signal: controller.signal }),
      getAssetHistory(client, { apiKey, assetId, signal: controller.signal }),
      getAssetTickets(client, { apiKey, assetId, signal: controller.signal }),
      getAssetSoftware(client, { apiKey, assetId, signal: controller.signal }),
      getAssetNotes(client, { apiKey, assetId, signal: controller.signal }),
    ]);
    if (controller.signal.aborted) return;
    if (!assetResult.ok) {
      if (assetResult.error.kind !== "canceled") setStatus("error");
      return;
    }
    setAsset(assetResult.data.data);
    // Each secondary section degrades to empty on its own failure.
    setMaintenance(maintResult.ok ? maintResult.data.data : []);
    setHistory(historyResult.ok ? historyResult.data.data : []);
    setTickets(ticketsResult.ok ? ticketsResult.data.data : []);
    setSoftware(softwareResult.ok ? softwareResult.data.data : []);
    setNotesBlockData(notesResult.ok ? notesResult.data.data.blockData : null);
    setStatus("ready");
  }, [client, apiKey, assetId]);

  const submitMaintenanceDone = useCallback(async () => {
    if (!client || !apiKey || !recordSchedule) return;
    setRecording(true);
    const result = await recordAssetMaintenance(client, {
      apiKey,
      assetId,
      data: {
        schedule_id: recordSchedule.schedule_id,
        maintenance_type: (recordSchedule.maintenance_type as "preventive") ?? "preventive",
        description: recordNote.trim() || undefined,
      },
    });
    setRecording(false);
    if (result.ok) {
      showToast({ tone: "success", message: t("maintenance.recorded", "Maintenance recorded") });
      setRecordSchedule(null);
      setRecordNote("");
      void fetchAll();
    } else {
      showToast({
        tone: "error",
        message: result.error.message || t("maintenance.recordFailed", "Couldn't record maintenance"),
      });
    }
  }, [client, apiKey, assetId, recordSchedule, recordNote, showToast, t, fetchAll]);

  const submitAddNote = useCallback(async () => {
    if (!client || !apiKey) return;
    const note = noteDraft.trim();
    if (!note) return;
    setSavingNote(true);
    // Append to the existing document so web-authored rich content survives.
    const result = await saveAssetNotes(client, {
      apiKey,
      assetId,
      blockData: appendNoteBlock(notesBlockData, note),
    });
    setSavingNote(false);
    if (result.ok) {
      showToast({ tone: "success", message: t("notes.saved", "Note added") });
      setNoteOpen(false);
      setNoteDraft("");
      void fetchAll();
    } else {
      showToast({
        tone: "error",
        message: result.error.message || t("notes.saveFailed", "Couldn't save note"),
      });
    }
  }, [client, apiKey, assetId, noteDraft, notesBlockData, showToast, t, fetchAll]);

  const refetchTickets = useCallback(async () => {
    if (!client || !apiKey) return;
    const result = await getAssetTickets(client, { apiKey, assetId });
    if (result.ok) setTickets(result.data.data);
  }, [client, apiKey, assetId]);

  const { refreshing, refresh } = usePullToRefresh(fetchAll);

  useEffect(() => {
    void fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  if (status === "loading") return <LoadingState message={t("detail.loading", "Loading device")} />;
  if (status === "error" || !asset) {
    return (
      <ErrorState
        title={t("errors.unableToLoad", "Unable to load this device.")}
        action={
          <Text
            onPress={() => void fetchAll()}
            testID="asset-detail-retry"
            style={{ ...theme.typography.body, color: theme.colors.primary }}
          >
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }

  const warranty = warrantyBadge(asset.warranty_status, t);
  const hasClient = Boolean(asset.client_id);
  const notesText = blockDataToText(notesBlockData);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: theme.spacing.md, gap: theme.spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {/* Identity */}
        <Card>
          <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{asset.name ?? assetName}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Badge label={warranty.label} tone={warranty.tone} />
            {asset.status ? <Badge label={asset.status} /> : null}
          </View>
          <View style={{ marginTop: theme.spacing.md }}>
            {asset.asset_tag ? <FieldRow label={t("identity.tag", "Tag")} value={asset.asset_tag} /> : null}
            {asset.serial_number ? <FieldRow label={t("identity.serial", "Serial")} value={asset.serial_number} /> : null}
            {asset.asset_type ? <FieldRow label={t("identity.type", "Type")} value={asset.asset_type} /> : null}
            {asset.client_name ? <FieldRow label={t("identity.client", "Client")} value={asset.client_name} /> : null}
            {asset.location ? <FieldRow label={t("identity.location", "Location")} value={asset.location} /> : null}
            {asset.warranty_end_date ? (
              <FieldRow label={t("identity.warrantyEnds", "Warranty ends")} value={asset.warranty_end_date.slice(0, 10)} />
            ) : null}
            {asset.purchase_date ? (
              <FieldRow label={t("identity.purchased", "Purchased")} value={formatDateShort(asset.purchase_date)} />
            ) : null}
          </View>
        </Card>

        {/* Actions */}
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <PrimaryButton onPress={() => setLinkOpen(true)} accessibilityLabel="asset-detail-link-ticket">
              {t("actions.linkTicket", "Link to a ticket")}
            </PrimaryButton>
            <PrimaryButton
              onPress={() => setCreateOpen(true)}
              disabled={!hasClient}
              accessibilityLabel="asset-detail-create-ticket"
            >
              {t("actions.createTicket", "Create a ticket about this device")}
            </PrimaryButton>
            {!hasClient ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, textAlign: "center" }}>
                {t("actions.noClient", "This device isn't linked to a client, so a ticket can't be created here.")}
              </Text>
            ) : null}
          </View>
        </Card>

        {/* Linked tickets */}
        <Card>
          <SectionTitle theme={theme}>{t("tickets.title", "Linked tickets")}</SectionTitle>
          {tickets.length === 0 ? (
            <EmptyLine theme={theme}>{t("tickets.empty", "No tickets linked to this device yet.")}</EmptyLine>
          ) : (
            tickets.map((ticket, index) => (
              <View key={ticket.ticket_id}>
                {index > 0 ? <Separator /> : null}
                <Pressable
                  onPress={() => navigation.navigate("TicketDetail", { ticketId: ticket.ticket_id })}
                  accessibilityRole="button"
                  accessibilityLabel={`asset-detail-ticket-${ticket.ticket_id}`}
                  testID={`asset-detail-ticket-${ticket.ticket_id}`}
                  style={({ pressed }) => ({ paddingVertical: theme.spacing.sm, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                    <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1 }} numberOfLines={2}>
                      {ticket.title ?? ticket.ticket_number ?? ticket.ticket_id}
                    </Text>
                    {ticket.status_name ? <Badge label={ticket.status_name} /> : null}
                  </View>
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                    {[ticket.ticket_number, ticket.relationship_type].filter(Boolean).join(" · ")}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </Card>

        {/* Maintenance */}
        <Card>
          <SectionTitle theme={theme}>{t("maintenance.title", "Maintenance")}</SectionTitle>
          {maintenance.length === 0 ? (
            <EmptyLine theme={theme}>{t("maintenance.empty", "No maintenance scheduled.")}</EmptyLine>
          ) : (
            maintenance.map((schedule, index) => {
              const dueBadge = maintenanceDueBadge(schedule.next_maintenance, t);
              const meta = [
                schedule.maintenance_type,
                schedule.frequency,
                schedule.next_maintenance
                  ? t("maintenance.next", "Next {{date}}", { date: formatDateShort(schedule.next_maintenance) })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <View key={schedule.schedule_id} testID={`asset-detail-maintenance-${schedule.schedule_id}`}>
                  {index > 0 ? <Separator /> : null}
                  <View style={{ paddingVertical: theme.spacing.sm }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                      <Text style={{ ...theme.typography.body, color: theme.colors.text, flex: 1 }}>
                        {schedule.schedule_name}
                      </Text>
                      {dueBadge ? <Badge label={dueBadge.label} tone={dueBadge.tone} /> : null}
                    </View>
                    {meta ? (
                      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                        {meta}
                      </Text>
                    ) : null}
                    {schedule.description ? (
                      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                        {schedule.description}
                      </Text>
                    ) : null}
                    <Text
                      onPress={() => {
                        setRecordSchedule(schedule);
                        setRecordNote("");
                      }}
                      testID={`asset-detail-maintenance-done-${schedule.schedule_id}`}
                      style={{ ...theme.typography.body, color: theme.colors.primary, marginTop: theme.spacing.xs }}
                    >
                      {t("maintenance.markDone", "Mark done")}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </Card>

        {/* Notes — a single BlockNote document shared with the web asset page */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle theme={theme}>{t("notes.title", "Notes")}</SectionTitle>
            <Text
              onPress={() => { setNoteDraft(""); setNoteOpen(true); }}
              testID="asset-detail-add-note"
              style={{ ...theme.typography.body, color: theme.colors.primary }}
            >
              {t("notes.add", "Add note")}
            </Text>
          </View>
          {notesText ? (
            <Text testID="asset-detail-notes-body" style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.xs }}>
              {notesText}
            </Text>
          ) : (
            <EmptyLine theme={theme}>{t("notes.empty", "No notes on this device yet.")}</EmptyLine>
          )}
        </Card>

        {/* Service history */}
        <Card>
          <SectionTitle theme={theme}>{t("history.title", "Service history")}</SectionTitle>
          {history.length === 0 ? (
            <EmptyLine theme={theme}>{t("history.empty", "No service history yet.")}</EmptyLine>
          ) : (
            history.map((item, index) => {
              const meta = [item.performed_at ? formatDateShort(item.performed_at) : null, item.performed_by_user_name]
                .filter(Boolean)
                .join(" · ");
              return (
                <View key={item.history_id} testID={`asset-detail-history-${item.history_id}`}>
                  {index > 0 ? <Separator /> : null}
                  <View style={{ paddingVertical: theme.spacing.sm }}>
                    <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                      {item.maintenance_type ?? item.description ?? t("history.title", "Service history")}
                    </Text>
                    {item.description && item.maintenance_type ? (
                      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                        {item.description}
                      </Text>
                    ) : null}
                    {meta ? (
                      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </Card>

        {/* Installed software (RMM-discovered; empty for unmanaged devices) */}
        {software.length > 0 ? (
          <Card>
            <SectionTitle theme={theme}>{t("software.title", "Installed software")}</SectionTitle>
            {software.map((item, index) => (
              <View key={item.software_id} testID={`asset-detail-software-${item.software_id}`}>
                {index > 0 ? <Separator /> : null}
                <View style={{ paddingVertical: theme.spacing.sm }}>
                  <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                    {item.name}
                    {item.version ? `  ${item.version}` : ""}
                  </Text>
                  {item.publisher ? (
                    <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
                      {item.publisher}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <Modal
        visible={recordSchedule !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRecordSchedule(null)}
      >
        <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.md, padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
              {t("maintenance.markDoneTitle", "Record maintenance")}
            </Text>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {recordSchedule?.schedule_name ?? ""}
            </Text>
            <TextInput
              value={recordNote}
              onChangeText={setRecordNote}
              label={t("maintenance.noteLabel", "What did you do?")}
              placeholder={t("maintenance.notePlaceholder", "Optional note")}
              multiline
              accessibilityLabel="asset-detail-maintenance-note"
            />
            <PrimaryButton
              onPress={() => void submitMaintenanceDone()}
              disabled={recording}
              accessibilityLabel="asset-detail-maintenance-record-submit"
            >
              {t("maintenance.recordDone", "Record as done")}
            </PrimaryButton>
            <Text
              onPress={() => setRecordSchedule(null)}
              testID="asset-detail-maintenance-record-cancel"
              style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.xs }}
            >
              {t("common.cancel", "Cancel")}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={noteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNoteOpen(false)}
      >
        <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.md, padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
              {t("notes.addTitle", "Add a note")}
            </Text>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              label={t("notes.label", "Note")}
              placeholder={t("notes.placeholder", "What should the team know about this device?")}
              multiline
              accessibilityLabel="asset-detail-note-input"
            />
            <PrimaryButton
              onPress={() => void submitAddNote()}
              disabled={savingNote || noteDraft.trim().length === 0}
              accessibilityLabel="asset-detail-note-submit"
            >
              {t("notes.save", "Save note")}
            </PrimaryButton>
            <Text
              onPress={() => setNoteOpen(false)}
              testID="asset-detail-note-cancel"
              style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.xs }}
            >
              {t("common.cancel", "Cancel")}
            </Text>
          </View>
        </View>
      </Modal>

      <LinkTicketModal
        visible={linkOpen}
        client={client}
        apiKey={apiKey}
        assetId={assetId}
        onClose={() => setLinkOpen(false)}
        onLinked={() => void refetchTickets()}
      />

      <CreateTicketModal
        visible={createOpen}
        client={client}
        apiKey={apiKey}
        assetId={assetId}
        clientId={asset.client_id}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void refetchTickets()}
      />
    </View>
  );
}
