import React from "react";
import { View } from "react-native";
import { useTheme } from "../ui/ThemeContext";
import { ScanView } from "../features/inventory/components/ScanView";

/**
 * The scanner as a pushed screen, so Home ▸ Scan and Assets ▸ Scan return to
 * where they started instead of leaving the drawer parked on Inventory.
 */
export function ScanScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScanView />
    </View>
  );
}
