import React from "react";
import { Modal, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SecondaryButton } from "./SecondaryButton";

export function WinConfirmModal({
  visible,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "center",
          padding: theme.spacing.xl,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.background,
            borderRadius: theme.borderRadius.xl,
            padding: theme.spacing.lg,
          }}
        >
          <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{t("won.title", "Mark won?")}</Text>
          <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.md }}>
            {t("won.body", "Close gates run on the server. Finish the conversion (agreement, project) on the web.")}
          </Text>

          {error ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{error}</Text>
          ) : null}

          <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.xl }}>
            <SecondaryButton
              testID="win-confirm-cancel"
              onPress={onClose}
              disabled={submitting}
              accessibilityLabel={t("common.cancel", "Cancel")}
            >
              {t("common.cancel", "Cancel")}
            </SecondaryButton>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                onPress={onConfirm}
                disabled={submitting}
                accessibilityLabel={t("won.confirm", "Mark won")}
              >
                {t("won.confirm", "Mark won")}
              </PrimaryButton>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
