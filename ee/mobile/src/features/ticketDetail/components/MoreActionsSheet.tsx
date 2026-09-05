import React from "react";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { copyToClipboard } from "../../../clipboard/clipboard";
import { buildTicketWebUrl } from "../../../urls/hostedUrls";

function SheetRow({
  icon,
  label,
  onPress,
  disabled,
  loading,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors, spacing, typography } = useTheme();
  const isDisabled = Boolean(disabled || loading);
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <Feather name={icon} size={18} color={colors.textSecondary} />
      )}
      <Text style={{ ...typography.body, color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

export function MoreActionsSheet({
  visible,
  onClose,
  baseUrl,
  ticketId,
  ticketNumber,
  isWatching,
  watchUpdating,
  watchDisabled,
  onToggleWatch,
}: {
  visible: boolean;
  onClose: () => void;
  baseUrl: string | null;
  ticketId: string;
  ticketNumber: string;
  isWatching: boolean;
  watchUpdating: boolean;
  watchDisabled?: boolean;
  onToggleWatch: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const openInWebUrl = baseUrl ? buildTicketWebUrl(baseUrl, ticketId) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm }}>
          <Text style={{ ...typography.title, color: colors.text }}>{t("detail.moreTitle", "More actions")}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} hitSlop={12}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>{t("common:close")}</Text>
          </Pressable>
        </View>

        <SheetRow
          icon={isWatching ? "eye-off" : "eye"}
          label={isWatching ? t("detail.unwatch") : t("detail.watch")}
          disabled={watchDisabled}
          loading={watchUpdating}
          onPress={() => {
            onClose();
            onToggleWatch();
          }}
        />
        <SheetRow
          icon="hash"
          label={t("detail.copyNumber")}
          onPress={() => {
            onClose();
            void (async () => {
              const res = await copyToClipboard("ticket_number", ticketNumber);
              Alert.alert(t("common:copied"), res.copiedText);
            })();
          }}
        />
        <SheetRow
          icon="copy"
          label={t("detail.copyId")}
          onPress={() => {
            onClose();
            void (async () => {
              const res = await copyToClipboard("ticket_id", ticketId);
              Alert.alert(t("common:copied"), res.copiedText);
            })();
          }}
        />
        {openInWebUrl ? (
          <SheetRow
            icon="external-link"
            label={t("detail.openInWeb")}
            onPress={() => {
              onClose();
              Alert.alert(t("detail.openInWebConfirm"), openInWebUrl, [
                { text: t("common:cancel"), style: "cancel" },
                { text: t("common:open"), onPress: () => void Linking.openURL(openInWebUrl) },
              ]);
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}
