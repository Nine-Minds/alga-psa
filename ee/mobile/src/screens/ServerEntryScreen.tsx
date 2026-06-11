import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { useAuth } from "../auth/AuthContext";
import { createApiClient } from "../api";
import { getAuthCapabilities } from "../api/mobileAuth";
import { isHostLocked } from "../config/appConfig";
import { normalizeHostInput } from "../config/hostStore";
import { parseServerHostPayload } from "../config/serverQr";
import { logger } from "../logging/logger";
import type { RootStackParamList } from "../navigation/types";

export function ServerEntryScreen() {
  const { t } = useTranslation("auth");
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ServerEntry">>();
  const { setHost, clearHost } = useAuth();

  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "validating" | "switching">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scanHandled = useRef(false);

  const hostLocked = isHostLocked();

  useEffect(() => {
    if (hostLocked) navigation.replace("SignIn");
  }, [hostLocked, navigation]);

  // Deep-link prefill only — the host is never saved without explicit confirm.
  useEffect(() => {
    const prefill = route.params?.url;
    if (!prefill) return;
    const parsed = parseServerHostPayload(prefill);
    if (parsed) setInput(parsed);
  }, [route.params?.url]);

  const onConnect = useCallback(async () => {
    const candidate = normalizeHostInput(input);
    if (!candidate) {
      setError(t("serverEntry.errors.invalidUrl"));
      return;
    }
    setError(null);
    setStatus("validating");
    try {
      const client = createApiClient({
        baseUrl: candidate,
        getUserAgentTag: () => `mobile/${Platform.OS}`,
      });
      const result = await getAuthCapabilities(client);
      if (!result.ok) {
        setError(
          result.error.kind === "network" || result.error.kind === "timeout"
            ? t("serverEntry.errors.unreachable")
            : t("serverEntry.errors.notAlga"),
        );
        return;
      }
      if (!result.data || typeof result.data.providers !== "object") {
        setError(t("serverEntry.errors.notAlga"));
        return;
      }
      if (result.data.enabled === false) {
        setError(t("serverEntry.errors.mobileNotAvailable"));
        return;
      }
      await setHost(candidate);
      navigation.navigate("SignIn");
    } catch (e) {
      logger.warn("Server validation failed", { error: e });
      setError(t("serverEntry.errors.unreachable"));
    } finally {
      setStatus("idle");
    }
  }, [input, navigation, setHost, t]);

  const onUseCloud = useCallback(async () => {
    setError(null);
    setStatus("switching");
    try {
      await clearHost();
      navigation.navigate("SignIn");
    } catch (e) {
      logger.warn("Failed to reset host", { error: e });
      setError(t("serverEntry.errors.saveFailed"));
    } finally {
      setStatus("idle");
    }
  }, [clearHost, navigation, t]);

  const onScanPress = useCallback(async () => {
    setError(null);
    if (scanning) {
      setScanning(false);
      return;
    }
    if (!permission?.granted) {
      const response = await requestPermission();
      if (!response.granted) {
        setError(t("serverEntry.errors.cameraDenied"));
        return;
      }
    }
    scanHandled.current = false;
    setScanning(true);
  }, [permission?.granted, requestPermission, scanning, t]);

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanHandled.current) return;
      scanHandled.current = true;
      const parsed = parseServerHostPayload(data);
      setScanning(false);
      if (parsed) {
        setInput(parsed);
        setError(null);
      } else {
        setError(t("serverEntry.errors.invalidQr"));
      }
    },
    [t],
  );

  if (hostLocked) return null;

  const busy = status !== "idle";

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: theme.spacing.xl,
        backgroundColor: theme.colors.background,
      }}
    >
      <Text style={{ ...theme.typography.title, textAlign: "center", color: theme.colors.text }}>
        {t("serverEntry.title")}
      </Text>
      <Text
        style={{
          ...theme.typography.body,
          marginTop: theme.spacing.md,
          textAlign: "center",
          color: theme.colors.textSecondary,
        }}
      >
        {t("serverEntry.subtitle")}
      </Text>

      <TextInput
        value={input}
        onChangeText={(value) => {
          setInput(value);
          setError(null);
        }}
        placeholder={t("serverEntry.placeholder")}
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!busy}
        accessibilityLabel={t("serverEntry.inputLabel")}
        style={{
          ...theme.typography.body,
          marginTop: theme.spacing.lg,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          color: theme.colors.text,
          backgroundColor: theme.colors.card,
        }}
      />

      {scanning ? (
        <View style={{ marginTop: theme.spacing.lg, borderRadius: 12, overflow: "hidden" }}>
          <CameraView
            style={{ height: 280 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <Text
            style={{
              ...theme.typography.caption,
              marginTop: theme.spacing.sm,
              textAlign: "center",
              color: theme.colors.textSecondary,
            }}
          >
            {t("serverEntry.scanHint")}
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.lg, alignItems: "center" }}>
        <PrimaryButton
          onPress={() => void onConnect()}
          disabled={busy || !input.trim()}
          accessibilityLabel={t("serverEntry.connect")}
        >
          {status === "validating" ? t("serverEntry.validating") : t("serverEntry.connect")}
        </PrimaryButton>
      </View>

      <View style={{ marginTop: theme.spacing.md, alignItems: "center" }}>
        <Text
          onPress={() => {
            if (!busy) void onScanPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("serverEntry.scanQr")}
          style={{
            ...theme.typography.body,
            color: theme.colors.secondary,
            paddingVertical: theme.spacing.sm,
          }}
        >
          {scanning ? t("serverEntry.cancelScan") : t("serverEntry.scanQr")}
        </Text>
        <Text
          onPress={() => {
            if (!busy) void onUseCloud();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("serverEntry.useCloud")}
          style={{
            ...theme.typography.body,
            color: theme.colors.secondary,
            paddingVertical: theme.spacing.sm,
          }}
        >
          {t("serverEntry.useCloud")}
        </Text>
      </View>

      {error ? (
        <Text
          style={{
            ...theme.typography.body,
            marginTop: theme.spacing.md,
            textAlign: "center",
            color: theme.colors.danger,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
