import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { ListRow, PrimaryButton, Separator } from "../../../ui/components";
import { EmptyState, ErrorState, LoadingState } from "../../../ui/states";
import { listTransfers, receiveTransfer, type StockTransferSummary } from "../../../api/inventory";
import { useInventoryApi } from "../hooks/useInventoryApi";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { useToast } from "../../../ui/toast/ToastProvider";

const PAGE_SIZE = 30;

export function TransfersView() {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const { showToast } = useToast();
  const [transfers, setTransfers] = useState<StockTransferSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-access">("loading");
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchTransfers = useCallback(async () => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await listTransfers(client, {
      apiKey,
      page: 1,
      limit: PAGE_SIZE,
      status: "dispatched",
      signal: controller.signal,
    });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      setStatus(result.error.kind === "permission" ? "no-access" : "error");
      return;
    }
    setTransfers(result.data.data);
    setStatus("ready");
  }, [client, apiKey]);

  useEffect(() => {
    void fetchTransfers();
    return () => abortRef.current?.abort();
  }, [fetchTransfers]);

  const { refreshing, refresh } = usePullToRefresh(fetchTransfers);

  const onReceive = useCallback(
    async (transferId: string) => {
      if (!client || !apiKey) return;
      setReceivingId(transferId);
      const result = await receiveTransfer(client, { apiKey, transferId });
      setReceivingId(null);
      if (result.ok) {
        showToast({ tone: "success", message: t("transfers.received", "Transfer received") });
        setTransfers((current) => current.filter((transfer) => transfer.transfer_id !== transferId));
      } else if (result.error.kind === "permission") {
        showToast({ tone: "error", message: t("adjust.noAccess", "You can't adjust stock at this location.") });
      } else {
        showToast({ tone: "error", message: t("scan.lookupFailed", "Lookup failed. Try again.") });
      }
    },
    [client, apiKey, showToast, t],
  );

  if (status === "no-access") {
    return <EmptyState title={t("common.noAccess", "You don't have access to inventory.")} />;
  }
  if (status === "error") {
    return (
      <ErrorState
        action={
          <Text onPress={() => void fetchTransfers()} style={{ ...theme.typography.body, color: theme.colors.primary }}>
            {t("common.retry", "Retry")}
          </Text>
        }
      />
    );
  }
  if (status === "loading") return <LoadingState />;

  return (
    <FlatList
      data={transfers}
      keyExtractor={(item) => item.transfer_id}
      ItemSeparatorComponent={Separator}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListEmptyComponent={<EmptyState title={t("transfers.empty", "No transfers in transit to your locations.")} />}
      renderItem={({ item }) => (
        <ListRow
          title={item.to_location_name ?? item.to_location_id}
          subtitle={t("transfers.from", "From {{location}}", { location: item.from_location_name ?? item.from_location_id })}
          rightContent={
            <PrimaryButton
              onPress={() => void onReceive(item.transfer_id)}
              disabled={receivingId === item.transfer_id}
              accessibilityLabel={`inventory-transfer-receive-${item.transfer_id}`}
            >
              {t("transfers.receive", "Receive transfer")}
            </PrimaryButton>
          }
          accessibilityLabel={`inventory-transfer-row-${item.transfer_id}`}
        />
      )}
    />
  );
}
