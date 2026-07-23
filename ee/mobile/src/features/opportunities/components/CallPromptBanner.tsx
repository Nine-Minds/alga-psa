import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { SecondaryButton } from "./SecondaryButton";
import type { PendingCallPrompt } from "../hooks/usePendingCallPrompt";

export function CallPromptBanner({
  prompt,
  onLog,
  onDismiss,
}: {
  prompt: PendingCallPrompt;
  onLog: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();

  return (
    <View
      testID="opportunity-detail-call-prompt"
      style={{
        marginTop: theme.spacing.lg,
        padding: theme.spacing.md,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.badge.info.bg,
        borderWidth: 1,
        borderColor: theme.colors.badge.info.border,
      }}
    >
      <Text style={{ ...theme.typography.body, color: theme.colors.badge.info.text }}>
        {t("callPrompt.title", "Log this call?")}
      </Text>
      <Text style={{ ...theme.typography.caption, color: theme.colors.badge.info.text, marginTop: 2 }}>
        {t("callPrompt.body", "You called {{name}}. Add it to the deal's record.", {
          name: prompt.contactName ?? "",
        })}
      </Text>
      <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
        <SecondaryButton
          testID="opportunity-detail-call-prompt-log"
          onPress={onLog}
          accessibilityLabel={t("callPrompt.log", "Log the call")}
        >
          {t("callPrompt.log", "Log the call")}
        </SecondaryButton>
        <SecondaryButton
          testID="opportunity-detail-call-prompt-dismiss"
          onPress={onDismiss}
          accessibilityLabel={t("callPrompt.dismiss", "Not now")}
        >
          {t("callPrompt.dismiss", "Not now")}
        </SecondaryButton>
      </View>
    </View>
  );
}
