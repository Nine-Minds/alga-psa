import React from "react";
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { SegmentChips } from "../features/inventory/components/SegmentChips";
import { ScanView } from "../features/inventory/components/ScanView";
import { StockView } from "../features/inventory/components/StockView";
import { CountsView } from "../features/inventory/components/CountsView";
import { PosView } from "../features/inventory/components/PosView";
import { TransfersView } from "../features/inventory/components/TransfersView";

type InventorySegment = "scan" | "stock" | "counts" | "pos" | "transfers";

export function InventoryScreen() {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const [segment, setSegment] = useState<InventorySegment>("scan");

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SegmentChips<InventorySegment>
        idPrefix="inventory"
        active={segment}
        onChange={setSegment}
        segments={[
          { key: "scan", label: t("segments.scan", "Scan") },
          { key: "stock", label: t("segments.stock", "Stock") },
          { key: "counts", label: t("segments.counts", "Counts") },
          { key: "pos", label: t("segments.pos", "POs") },
          { key: "transfers", label: t("transfers.title", "Transfers") },
        ]}
      />
      {segment === "scan" ? <ScanView /> : null}
      {segment === "stock" ? <StockView /> : null}
      {segment === "counts" ? <CountsView /> : null}
      {segment === "pos" ? <PosView /> : null}
      {segment === "transfers" ? <TransfersView /> : null}
    </View>
  );
}
