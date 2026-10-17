import React, { useCallback, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { IconButton, PrimaryButton, TextInput } from "../../../ui/components";
import { INVENTORY_BARCODE_TYPES } from "../../inventory/barcodeTypes";
import { useScanDebounce } from "../../inventory/scanDebounce";

/**
 * The audit's camera: the same barcode types and repeat debounce as the
 * Inventory scanner, in a modal that only hands the code back — resolving it
 * is the session's job, and the audit needs no result cards.
 */
export function AuditScanner({
  visible,
  busy,
  error,
  onScan,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  error: string | null;
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("assets");
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const scanDebounce = useScanDebounce();

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      const code = data?.trim();
      if (!code) return;
      if (!scanDebounce.accept(code)) return;
      onScan(code);
    },
    [onScan, scanDebounce],
  );

  const showCamera = visible && permission?.granted === true && !manualMode;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="audit-scanner">
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: theme.spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
            {t("audit.scanTitle", "Scan a device")}
          </Text>
          <Pressable
            testID="audit-scanner-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel", "Cancel")}
            hitSlop={8}
          >
            <Feather name="x" size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {showCamera ? (
            <>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                enableTorch={torchOn}
                barcodeScannerSettings={{ barcodeTypes: [...INVENTORY_BARCODE_TYPES] }}
                onBarcodeScanned={busy ? undefined : handleBarcode}
              />
              <View
                style={{
                  position: "absolute",
                  top: theme.spacing.md,
                  right: theme.spacing.md,
                  flexDirection: "row",
                  gap: theme.spacing.sm,
                  backgroundColor: "rgba(0,0,0,0.45)",
                  borderRadius: theme.borderRadius.md,
                  paddingHorizontal: theme.spacing.xs,
                }}
              >
                <IconButton
                  onPress={() => setTorchOn((value) => !value)}
                  accessibilityLabel={
                    torchOn
                      ? t("audit.torchOff", "Turn flashlight off")
                      : t("audit.torchOn", "Turn flashlight on")
                  }
                  icon={
                    <MaterialCommunityIcons
                      name={torchOn ? "flashlight-off" : "flashlight"}
                      size={22}
                      color={theme.colors.overlayText}
                    />
                  }
                />
                <IconButton
                  testID="audit-scanner-manual"
                  onPress={() => setManualMode(true)}
                  accessibilityLabel={t("audit.manualEntry", "Enter code manually")}
                  icon={
                    <MaterialCommunityIcons
                      name="keyboard-outline"
                      size={22}
                      color={theme.colors.overlayText}
                    />
                  }
                />
              </View>
            </>
          ) : (
            <View style={{ flex: 1, padding: theme.spacing.lg, justifyContent: "center" }}>
              {permission?.granted !== true && !manualMode ? (
                <>
                  <Text style={{ ...theme.typography.body, color: theme.colors.text, marginBottom: theme.spacing.md }}>
                    {t("audit.cameraNeeded", "The camera is needed to scan device labels.")}
                  </Text>
                  <PrimaryButton testID="audit-scanner-permission" onPress={() => void requestPermission()}>
                    {t("audit.allowCamera", "Allow camera")}
                  </PrimaryButton>
                  <View style={{ height: theme.spacing.md }} />
                </>
              ) : null}
              <TextInput
                testID="audit-scanner-code"
                label={t("audit.code", "Code")}
                value={manualCode}
                onChangeText={setManualCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <View style={{ height: theme.spacing.md }} />
              <PrimaryButton
                testID="audit-scanner-submit"
                onPress={() => {
                  const code = manualCode.trim();
                  if (!code) return;
                  setManualCode("");
                  onScan(code);
                }}
                disabled={manualCode.trim().length === 0 || busy}
              >
                {t("audit.lookUp", "Look up")}
              </PrimaryButton>
            </View>
          )}
        </View>

        {error ? (
          <Text
            testID="audit-scanner-error"
            style={{ ...theme.typography.caption, color: theme.colors.danger, padding: theme.spacing.lg }}
          >
            {error}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}
