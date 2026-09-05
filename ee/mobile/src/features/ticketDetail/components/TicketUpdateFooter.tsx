import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TicketNotificationSuppressionOptions } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";

export const DEFAULT_TICKET_NOTIFICATION_SUPPRESSION: TicketNotificationSuppressionOptions = {
  suppressContactNotifications: false,
  suppressInternalNotifications: false,
};

export function activeTicketNotificationSuppression(
  value: TicketNotificationSuppressionOptions,
): TicketNotificationSuppressionOptions | undefined {
  return value.suppressContactNotifications ? value : undefined;
}

export function TicketNotificationSuppressionControl({
  value,
  onChange,
  disabled = false,
}: {
  value: TicketNotificationSuppressionOptions;
  onChange: (next: TicketNotificationSuppressionOptions) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();

  return (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.body, color: colors.text, fontWeight: "600" }}>
            {t("notifications.suppression.contactLabel", "Don't notify the customer")}
          </Text>
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
            {t("notifications.suppression.contactHelper", "Skips customer email and portal notifications")}
          </Text>
        </View>
        <Switch
          testID="ticket-suppress-contact-notifications"
          accessibilityLabel={t("notifications.suppression.contactLabel", "Don't notify the customer")}
          value={value.suppressContactNotifications}
          disabled={disabled}
          trackColor={{ false: colors.border, true: colors.primary }}
          ios_backgroundColor={colors.border}
          onValueChange={(checked) =>
            onChange({
              suppressContactNotifications: checked,
              suppressInternalNotifications: checked ? value.suppressInternalNotifications : false,
            })
          }
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingLeft: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              ...typography.body,
              color: value.suppressContactNotifications ? colors.text : colors.textSecondary,
              fontWeight: "600",
            }}
          >
            {t("notifications.suppression.internalLabel", "Also don't notify agents and watchers")}
          </Text>
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
            {t("notifications.suppression.internalHelper", "Skips their email and in-app notifications too")}
          </Text>
        </View>
        <Switch
          testID="ticket-suppress-internal-notifications"
          accessibilityLabel={t("notifications.suppression.internalLabel", "Also don't notify agents and watchers")}
          value={value.suppressContactNotifications && value.suppressInternalNotifications}
          disabled={disabled || !value.suppressContactNotifications}
          trackColor={{ false: colors.border, true: colors.primary }}
          ios_backgroundColor={colors.border}
          onValueChange={(checked) =>
            onChange({
              suppressContactNotifications: true,
              suppressInternalNotifications: checked,
            })
          }
        />
      </View>
    </View>
  );
}

export function TicketUpdateFooter({
  suppression,
  onSuppressionChange,
  onCancel,
  onApply,
  applyLabel,
  cancelLabel,
  applyDisabled = false,
  busy = false,
}: {
  suppression: TicketNotificationSuppressionOptions;
  onSuppressionChange: (next: TicketNotificationSuppressionOptions) => void;
  onCancel: () => void;
  onApply: () => void;
  applyLabel?: string;
  cancelLabel?: string;
  applyDisabled?: boolean;
  busy?: boolean;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={{ gap: spacing.md, paddingTop: spacing.md }}>
      <TicketNotificationSuppressionControl
        value={suppression}
        onChange={onSuppressionChange}
        disabled={busy}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel ?? t("common:cancel")}
          disabled={busy}
          onPress={onCancel}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            opacity: busy ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ ...typography.body, color: colors.text, fontWeight: "600" }}>
            {t("common:cancel")}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            onPress={onApply}
            disabled={busy || applyDisabled}
            accessibilityLabel={applyLabel ?? t("common:apply", "Apply")}
          >
            {applyLabel ?? t("common:apply", "Apply")}
          </PrimaryButton>
        </View>
      </View>
    </View>
  );
}
