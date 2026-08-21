import React from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../../navigation/types";
import { hitSlop } from "../../../ui/a11y";
import { useTheme } from "../../../ui/ThemeContext";
import { useTimer, useTimerElapsedMs } from "../TimerContext";
import { formatElapsedClock } from "../timerLogic";

export function HeaderTimerChip() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("timeEntries");
  const { status, session, openStopModal } = useTimer();
  const elapsedMs = useTimerElapsedMs();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  if (status !== "running" || !session || elapsedMs === null) return null;

  const ticketId = session.work_item_type === "ticket" ? session.work_item_id : null;
  const title = session.work_item_title ?? t("timer.banner.untitled");

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.primary,
        backgroundColor: colors.card,
        paddingLeft: spacing.sm,
      }}
      accessibilityRole="summary"
      accessibilityLabel={t("timer.banner.accessibility", { title })}
    >
      <Pressable
        onPress={ticketId ? () => navigation.navigate("TicketDetail", { ticketId }) : undefined}
        disabled={!ticketId}
        accessibilityRole="button"
        accessibilityLabel={t("timer.banner.openWorkItem", { title })}
        hitSlop={hitSlop}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingVertical: 4,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
        <Text style={{ ...typography.caption, color: colors.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
          {formatElapsedClock(elapsedMs)}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => openStopModal()}
        accessibilityRole="button"
        accessibilityLabel={t("timer.banner.stop")}
        hitSlop={hitSlop}
        style={({ pressed }) => ({
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Feather name="stop-circle" size={16} color={colors.primary} />
      </Pressable>
    </View>
  );
}
