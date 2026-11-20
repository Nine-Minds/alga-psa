import React from "react";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { SegmentChips } from "../features/inventory/components/SegmentChips";
import { HomeView } from "../features/inventory/components/HomeView";
import { ScanView } from "../features/inventory/components/ScanView";
import { StockView } from "../features/inventory/components/StockView";
import { CountsView } from "../features/inventory/components/CountsView";
import { PosView } from "../features/inventory/components/PosView";
import { TransfersView } from "../features/inventory/components/TransfersView";
import type { InventorySegment } from "../features/inventory/segments";
import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { DrawerParamList } from "../navigation/types";

type Props = Partial<DrawerScreenProps<DrawerParamList, "InventoryTab">>;

export function InventoryScreen({ route }: Props = {}) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const requestedSegment = route?.params?.segment;
  const [segment, setSegment] = useState<InventorySegment>(requestedSegment ?? "home");

  // Assets ▸ Scan navigates here with the segment it wants.
  useEffect(() => {
    if (requestedSegment) setSegment(requestedSegment);
  }, [requestedSegment]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SegmentChips<InventorySegment>
        idPrefix="inventory"
        active={segment}
        onChange={setSegment}
        segments={[
          { key: "home", label: t("segments.home", "Today") },
          { key: "scan", label: t("segments.scan", "Scan") },
          { key: "stock", label: t("segments.stock", "Stock") },
          { key: "counts", label: t("segments.counts", "Counts") },
          { key: "pos", label: t("segments.pos", "POs") },
          { key: "transfers", label: t("transfers.title", "Transfers") },
        ]}
      />
      {segment === "home" ? <HomeView onOpenSegment={setSegment} /> : null}
      {segment === "scan" ? <ScanView /> : null}
      {segment === "stock" ? <StockView /> : null}
      {segment === "counts" ? <CountsView /> : null}
      {segment === "pos" ? <PosView /> : null}
      {segment === "transfers" ? <TransfersView /> : null}
    </View>
  );
}
