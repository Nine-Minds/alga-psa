import React from "react";
import { useCallback, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, Vibration, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton, TextInput } from "../../../ui/components";
import { INVENTORY_BARCODE_TYPES } from "../barcodeTypes";

const REPEAT_SCAN_MS = 1200;

export function SerialAccumulator({
  visible,
  target,
  initialSerials,
  onDone,
  onCancel,
}: {
  visible: boolean;
  target?: number;
  initialSerials?: string[];
  onDone: (serials: string[]) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const [permission, requestPermission] = useCameraPermissions();
  const [serials, setSerials] = useState<string[]>(initialSerials ?? []);
  const [manualSerial, setManualSerial] = useState("");
  const [duplicateFlash, setDuplicateFlash] = useState<string | null>(null);
  const lastReadRef = useRef<{ code: string; atMs: number } | null>(null);

  const addSerial = useCallback(
    (raw: string) => {
      const serial = raw.trim();
      if (!serial) return;
      setSerials((current) => {
        if (current.includes(serial)) {
          Vibration.vibrate([0, 60, 60, 60]);
          setDuplicateFlash(serial);
          setTimeout(() => setDuplicateFlash(null), 1500);
          return current;
        }
        Vibration.vibrate(30);
        return [...current, serial];
      });
    },
    [],
  );

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (!data) return;
      const now = Date.now();
      const last = lastReadRef.current;
      if (last && last.code === data && now - last.atMs < REPEAT_SCAN_MS) return;
      lastReadRef.current = { code: data, atMs: now };
      addSerial(data);
    },
    [addSerial],
  );

  const removeSerial = useCallback((serial: string) => {
    setSerials((current) => current.filter((value) => value !== serial));
  }, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ flex: 1 }}>
          {visible && permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...INVENTORY_BARCODE_TYPES] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          ) : (
            <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.xl, gap: theme.spacing.md }}>
              <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center" }}>
                {t("scan.permissionBody", "Allow camera access to scan barcodes, serial numbers, and MAC labels.")}
              </Text>
              <PrimaryButton onPress={() => void requestPermission()} accessibilityLabel="inventory-serials-request-permission">
                {t("scan.permissionTitle", "Camera access needed")}
              </PrimaryButton>
            </View>
          )}
          {duplicateFlash ? (
            <View style={{ position: "absolute", top: theme.spacing.lg, left: 0, right: 0, alignItems: "center" }}>
              <View style={{ backgroundColor: theme.colors.badge.warning.bg, borderColor: theme.colors.badge.warning.border, borderWidth: 1, borderRadius: theme.borderRadius.md, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs }}>
                <Text style={{ ...theme.typography.caption, color: theme.colors.badge.warning.text }} testID="inventory-serials-duplicate">
                  {t("receive.duplicateSerial", "Serial already captured")}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "600" }} testID="inventory-serials-progress">
            {target
              ? t("receive.serialsProgress", "{{count}} of {{total}} serials", { count: serials.length, total: target })
              : `${serials.length}`}
          </Text>
          {serials.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
              <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
                {serials.map((serial) => (
                  <Pressable
                    key={serial}
                    onPress={() => removeSerial(serial)}
                    testID={`inventory-serial-chip-${serial}`}
                    accessibilityLabel={`remove-serial-${serial}`}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: theme.colors.borderLight,
                      borderRadius: theme.borderRadius.md,
                      paddingHorizontal: theme.spacing.sm,
                      paddingVertical: theme.spacing.xs,
                    }}
                  >
                    <Text style={{ ...theme.typography.caption, color: theme.colors.text }}>{serial}</Text>
                    <MaterialCommunityIcons name="close" size={14} color={theme.colors.textSecondary} />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: "row", gap: theme.spacing.sm, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <TextInput
                value={manualSerial}
                onChangeText={setManualSerial}
                placeholder={t("receive.addManually", "Add manually")}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="inventory-serials-manual-input"
              />
            </View>
            <Pressable
              onPress={() => {
                addSerial(manualSerial);
                setManualSerial("");
              }}
              disabled={!manualSerial.trim()}
              testID="inventory-serials-manual-add"
              accessibilityRole="button"
              accessibilityLabel={t("receive.addManually", "Add manually")}
            >
              <MaterialCommunityIcons
                name="plus-circle-outline"
                size={28}
                color={manualSerial.trim() ? theme.colors.primary : theme.colors.border}
              />
            </Pressable>
          </View>
          <PrimaryButton
            onPress={() => onDone(serials)}
            disabled={target !== undefined && serials.length !== target}
            accessibilityLabel="inventory-serials-done"
          >
            {t("common.done", "Done")}
          </PrimaryButton>
          <Text
            onPress={onCancel}
            testID="inventory-serials-cancel"
            style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.xs }}
          >
            {t("common.cancel", "Cancel")}
          </Text>
        </View>
      </View>
    </Modal>
  );
}
