import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "../ui/ThemeContext";
import { ListRow, PrimaryButton, Separator, TextInput } from "../ui/components";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import {
  getCountSession,
  lookupInventoryCode,
  recordCount,
  submitCountSession,
  type CountLineRow,
  type CountSessionSummary,
} from "../api/inventory";
import { useInventoryApi } from "../features/inventory/hooks/useInventoryApi";
import { useToast } from "../ui/toast/ToastProvider";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "CountSession">;

export function CountSessionScreen({ route, navigation }: Props) {
  const { sessionId } = route.params;
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const { showToast } = useToast();
  const [session, setSession] = useState<(CountSessionSummary & { lines: CountLineRow[] }) | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [scanCode, setScanCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingLine, setEditingLine] = useState<CountLineRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const fetchSession = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await getCountSession(client, { apiKey, sessionId, signal: controller.signal });
    if (!result.ok) {
      if (result.error.kind !== "canceled") setStatus("error");
      return;
    }
    setSession(result.data.data);
    setStatus("ready");
  }, [client, apiKey, sessionId]);

  useEffect(() => {
    void fetchSession();
    return () => abortRef.current?.abort();
  }, [fetchSession]);

  const record = useCallback(
    async (serviceId: string, countedQuantity: number) => {
      if (!client || !apiKey) return;
      const result = await recordCount(client, {
        apiKey,
        sessionId,
        data: { service_id: serviceId, counted_quantity: countedQuantity },
      });
      if (result.ok) {
        void fetchSession();
      } else {
        showToast({ tone: "error", message: result.error.message ?? t("scan.lookupFailed", "Lookup failed. Try again.") });
      }
    },
    [client, apiKey, sessionId, fetchSession, showToast, t],
  );

  const onScanSubmit = useCallback(async () => {
    const code = scanCode.trim();
    if (!code || !client || !apiKey || !session) return;
    setScanCode("");
    const lookup = await lookupInventoryCode(client, { apiKey, code });
    if (!lookup.ok) {
      showToast({ tone: "error", message: t("scan.lookupFailed", "Lookup failed. Try again.") });
      return;
    }
    const data = lookup.data.data;
    const serviceId =
      data.type === "product" ? data.product.service_id : data.type === "unit" ? data.unit.service_id : null;
    if (!serviceId) {
      showToast({ tone: "error", message: t("scan.noMatchTitle", "No match") });
      return;
    }
    const existing = session.lines.find((line) => line.service_id === serviceId);
    void record(serviceId, (existing?.counted_quantity ?? 0) + 1);
  }, [scanCode, client, apiKey, session, record, showToast, t]);

  const onSubmitForReview = useCallback(() => {
    Alert.alert(
      t("counts.submitConfirmTitle", "Submit count?"),
      t("counts.submitConfirmBody", "Submitted counts are reviewed and approved on the web."),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("counts.submit", "Submit for review"),
          onPress: () => {
            void (async () => {
              if (!client || !apiKey) return;
              setSubmitting(true);
              const result = await submitCountSession(client, { apiKey, sessionId });
              setSubmitting(false);
              if (result.ok) {
                showToast({ tone: "success", message: t("counts.submitted", "Count submitted for review") });
                navigation.goBack();
              } else {
                showToast({ tone: "error", message: result.error.message ?? t("scan.lookupFailed", "Lookup failed. Try again.") });
              }
            })();
          },
        },
      ],
    );
  }, [client, apiKey, sessionId, navigation, showToast, t]);

  if (status === "loading") return <LoadingState />;
  if (status === "error" || !session) {
    return (
      <ErrorState
        action={
          <Text onPress={() => void fetchSession()} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }

  const isOpen = session.status === "open";

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {isOpen ? (
        <View style={{ padding: theme.spacing.md, flexDirection: "row", gap: theme.spacing.sm, alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <TextInput
              value={scanCode}
              onChangeText={setScanCode}
              placeholder={t("scan.manualPlaceholder", "Barcode, SKU, serial, or MAC")}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="inventory-count-scan-input"
            />
          </View>
          <PrimaryButton onPress={() => void onScanSubmit()} disabled={!scanCode.trim()} accessibilityLabel="inventory-count-scan-add">
            {t("counts.addLine", "Add product")}
          </PrimaryButton>
        </View>
      ) : null}
      <FlatList
        data={session.lines}
        keyExtractor={(item) => item.service_id}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={<EmptyState title={t("counts.empty", "No count sessions.")} />}
        renderItem={({ item }) => (
          <ListRow
            title={item.service_name ?? item.service_id}
            subtitle={item.sku ?? undefined}
            onPress={
              isOpen
                ? () => {
                    setEditingLine(item);
                    setEditValue(String(item.counted_quantity));
                  }
                : undefined
            }
            rightContent={
              isOpen ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                  <Pressable
                    onPress={() => {
                      setEditingLine(item);
                      setEditValue(String(item.counted_quantity));
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`inventory-count-line-${item.service_id}`}
                    hitSlop={8}
                    style={{
                      minWidth: 56,
                      alignItems: "center",
                      paddingVertical: theme.spacing.sm,
                      paddingHorizontal: theme.spacing.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: theme.borderRadius.md,
                      backgroundColor: theme.colors.card,
                    }}
                  >
                    <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }}>
                      {item.counted_quantity}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void record(item.service_id, item.counted_quantity + 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`inventory-count-increment-${item.service_id}`}
                    hitSlop={8}
                  >
                    <MaterialCommunityIcons name="plus-circle" size={34} color={theme.colors.primary} />
                  </Pressable>
                </View>
              ) : (
                <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{item.counted_quantity}</Text>
              )
            }
            accessibilityLabel={`inventory-count-row-${item.service_id}`}
          />
        )}
      />
      {isOpen ? (
        <View style={{ padding: theme.spacing.md }}>
          <PrimaryButton onPress={onSubmitForReview} disabled={submitting} accessibilityLabel="inventory-count-submit">
            {t("counts.submit", "Submit for review")}
          </PrimaryButton>
        </View>
      ) : null}
      <Modal
        visible={editingLine !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingLine(null)}
      >
        <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.md, padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
              {editingLine?.service_name ?? ""}
            </Text>
            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              numericMode="integer"
              label={t("counts.countedLabel", "Counted quantity")}
              accessibilityLabel="inventory-count-edit-value"
            />
            <PrimaryButton
              onPress={() => {
                const value = Number.parseInt(editValue, 10);
                if (editingLine && Number.isFinite(value) && value >= 0) {
                  void record(editingLine.service_id, value);
                }
                setEditingLine(null);
              }}
              disabled={editValue.trim() === ""}
              accessibilityLabel="inventory-count-edit-save"
            >
              {t("counts.saveCount", "Save count")}
            </PrimaryButton>
            <Text
              onPress={() => setEditingLine(null)}
              testID="inventory-count-edit-cancel"
              style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.xs }}
            >
              {t("common.cancel", "Cancel")}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
