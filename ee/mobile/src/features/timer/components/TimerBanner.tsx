import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { hitSlop } from "../../../ui/a11y";
import { useTheme } from "../../../ui/ThemeContext";
import { useTimer, useTimerElapsedMs } from "../TimerContext";
import { formatElapsedClock } from "../timerLogic";

export function TimerBanner({ onOpenTicket }: { onOpenTicket: (ticketId: string) => void }) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("timeEntries");
  const { status, session, openStopModal } = useTimer();
  const elapsedMs = useTimerElapsedMs();

  if (status !== "running" || !session || elapsedMs === null) return null;

  const ticketId = session.work_item_type === "ticket" ? session.work_item_id : null;
  const title = session.work_item_title ?? t("timer.banner.untitled");

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.md,
      }}
      accessibilityRole="summary"
      accessibilityLabel={t("timer.banner.accessibility", { title })}
    >
      <Pressable
        onPress={ticketId ? () => onOpenTicket(ticketId) : undefined}
        disabled={!ticketId}
        accessibilityRole="button"
        accessibilityLabel={t("timer.banner.openWorkItem", { title })}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.primary,
          }}
        />
        <Text style={{ ...typography.body, color: colors.text, fontWeight: "600" }}>
          {formatElapsedClock(elapsedMs)}
        </Text>
        <Text
          style={{ ...typography.caption, color: colors.textSecondary, flexShrink: 1 }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => openStopModal()}
        accessibilityRole="button"
        accessibilityLabel={t("timer.banner.stop")}
        hitSlop={hitSlop}
      >
        <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>
          {t("timer.banner.stop")}
        </Text>
      </Pressable>
    </View>
  );
}
