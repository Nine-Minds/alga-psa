import React from "react";
import { useCallback, useRef, useState } from "react";
import { Linking, Text, Vibration, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../../../ui/ThemeContext";
import { IconButton, PrimaryButton, TextInput } from "../../../ui/components";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";
import { lookupInventoryCode, type InventoryLookupResult } from "../../../api/inventory";
import { listProducts, setProductBarcode } from "../../../api/materials";
import { useInventoryApi } from "../hooks/useInventoryApi";
import { useToast } from "../../../ui/toast/ToastProvider";
import { ScanResultCard } from "./ScanResultCard";
import type { RootStackParamList } from "../../../navigation/types";

import { INVENTORY_BARCODE_TYPES } from "../barcodeTypes";

const SCAN_DEBOUNCE_MS = 1500;

export function ScanView() {
  const theme = useTheme();
  // Drawer screens stay mounted while other tabs are open; an unmounted-but-live
  // CameraView holds the iOS camera session and comes back as a black feed.
  // Only mount the camera while this screen is actually focused.
  const isFocused = useIsFocused();
  const { t } = useTranslation("inventory");
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client, apiKey } = useInventoryApi();
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [result, setResult] = useState<InventoryLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastScanRef = useRef<{ code: string; atMs: number } | null>(null);
  const { showToast } = useToast();
  const [attachPickerVisible, setAttachPickerVisible] = useState(false);
  const [attachItems, setAttachItems] = useState<EntityPickerItem[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);

  const searchAttachProducts = useCallback(
    async (query: string) => {
      if (!client || !apiKey) return;
      setAttachLoading(true);
      const result = await listProducts(client, { apiKey, search: query || undefined, limit: 20 });
      setAttachLoading(false);
      if (result.ok) {
        setAttachItems(
          result.data.data.map((product) => ({
            id: product.service_id,
            label: product.service_name,
            subtitle: product.sku ?? null,
          })),
        );
      }
    },
    [client, apiKey],
  );

  const resolveCode = useCallback(
    async (code: string) => {
      if (!client || !apiKey) return;
      setBusy(true);
      setLookupError(null);
      const response = await lookupInventoryCode(client, { apiKey, code });
      setBusy(false);
      if (response.ok) {
        setScannedCode(code);
        setResult(response.data.data);
      } else if (response.error.kind !== "canceled") {
        setLookupError(t("scan.lookupFailed", "Lookup failed. Try again."));
      }
    },
    [client, apiKey, t],
  );

  const attachBarcodeToProduct = useCallback(
    async (productId: string, productLabel: string) => {
      if (!client || !apiKey || !scannedCode) return;
      setAttachPickerVisible(false);
      const result = await setProductBarcode(client, { apiKey, productId, barcode: scannedCode });
      if (result.ok) {
        showToast({ tone: "success", message: t("scan.attachSuccess", "Barcode added to {{name}}", { name: productLabel }) });
        void resolveCode(scannedCode);
      } else {
        showToast({ tone: "error", message: result.error.message ?? t("scan.lookupFailed", "Lookup failed. Try again.") });
      }
    },
    [client, apiKey, scannedCode, showToast, t, resolveCode],
  );


  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (!data || busy || result) return;
      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.code === data && now - last.atMs < SCAN_DEBOUNCE_MS) return;
      lastScanRef.current = { code: data, atMs: now };
      Vibration.vibrate(30);
      void resolveCode(data.trim());
    },
    [busy, result, resolveCode],
  );

  const dismissResult = useCallback(() => {
    setResult(null);
    setScannedCode(null);
    lastScanRef.current = null;
  }, []);

  if (!permission) {
    return null;
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl, gap: theme.spacing.md }}>
        <Text style={{ ...theme.typography.title, color: theme.colors.text, textAlign: "center" }}>
          {t("scan.permissionTitle", "Camera access needed")}
        </Text>
        <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center" }}>
          {t("scan.permissionBody", "Allow camera access to scan barcodes, serial numbers, and MAC labels.")}
        </Text>
        {permission.canAskAgain ? (
          <PrimaryButton onPress={() => void requestPermission()} accessibilityLabel="inventory-scan-request-permission">
            {t("scan.permissionTitle", "Camera access needed")}
          </PrimaryButton>
        ) : (
          <PrimaryButton onPress={() => void Linking.openSettings()} accessibilityLabel="inventory-scan-open-settings">
            {t("scan.openSettings", "Open Settings")}
          </PrimaryButton>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {!manualMode && isFocused ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torchOn}
            barcodeScannerSettings={{ barcodeTypes: [...INVENTORY_BARCODE_TYPES] }}
            onBarcodeScanned={result ? undefined : onBarcodeScanned}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl, gap: theme.spacing.md }}>
            <TextInput
              value={manualCode}
              onChangeText={setManualCode}
              placeholder={t("scan.manualPlaceholder", "Barcode, SKU, serial, or MAC")}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="inventory-scan-manual-input"
            />
            <PrimaryButton
              onPress={() => manualCode.trim() && void resolveCode(manualCode.trim())}
              disabled={!manualCode.trim() || busy}
              accessibilityLabel="inventory-scan-manual-submit"
            >
              {t("segments.scan", "Scan")}
            </PrimaryButton>
            <Text
              onPress={() => setManualMode(false)}
              testID="inventory-scan-back-to-camera"
              style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center" }}
            >
              {t("scan.rescan", "Scan again")}
            </Text>
          </View>
        )}
        {!manualMode ? (
          <>
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" }}>
              <View
                style={{
                  width: 240,
                  height: 160,
                  borderWidth: 2,
                  borderColor: theme.colors.primary,
                  borderRadius: theme.borderRadius.md,
                  opacity: 0.9,
                }}
              />
              <Text style={{ ...theme.typography.caption, color: "#ffffff", marginTop: theme.spacing.md, textShadowColor: "#000000", textShadowRadius: 4 }}>
                {t("scan.instruction", "Point the camera at a barcode")}
              </Text>
            </View>
            <View style={{ position: "absolute", top: theme.spacing.md, right: theme.spacing.md, flexDirection: "row", gap: theme.spacing.sm }}>
              <IconButton
                onPress={() => setTorchOn((value) => !value)}
                accessibilityLabel={torchOn ? t("scan.torchOff", "Turn flashlight off") : t("scan.torchOn", "Turn flashlight on")}
                icon={<MaterialCommunityIcons name={torchOn ? "flashlight-off" : "flashlight"} size={22} color="#ffffff" />}
              />
              <IconButton
                onPress={() => setManualMode(true)}
                accessibilityLabel={t("scan.manualEntry", "Enter code manually")}
                icon={<MaterialCommunityIcons name="keyboard-outline" size={22} color="#ffffff" />}
              />
            </View>
          </>
        ) : null}
      </View>
      {lookupError ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.danger, textAlign: "center", padding: theme.spacing.sm }}>
          {lookupError}
        </Text>
      ) : null}
      {result && scannedCode ? (
        <ScanResultCard
          code={scannedCode}
          result={result}
          onOpenProduct={(serviceId, serviceName) => {
            dismissResult();
            navigation.navigate("StockProductDetail", { serviceId, serviceName });
          }}
          onReceiveProduct={(serviceId, serviceName, isSerialized) => {
            dismissResult();
            navigation.navigate("InventoryReceive", { serviceId, serviceName, isSerialized });
          }}
          onOpenUnit={(unitId) => {
            dismissResult();
            navigation.navigate("StockUnitDetail", { unitId });
          }}
          onManualSearch={() => {
            dismissResult();
            setManualMode(true);
          }}
          onDismiss={dismissResult}
          onAttachBarcode={() => {
            setAttachPickerVisible(true);
            void searchAttachProducts("");
          }}
        />
      ) : null}
      <EntityPickerModal
        visible={attachPickerVisible}
        title={t("scan.attachTitle", "Add barcode to which product?")}
        searchPlaceholder={t("stock.searchPlaceholder", "Search products or SKU")}
        emptyLabel={t("stock.empty", "No stock-tracked products yet.")}
        items={attachItems}
        loading={attachLoading}
        error={null}
        onSearch={(query) => void searchAttachProducts(query)}
        onSelect={(id, label) => void attachBarcodeToProduct(id, label)}
        onClose={() => setAttachPickerVisible(false)}
      />
    </View>
  );
}
