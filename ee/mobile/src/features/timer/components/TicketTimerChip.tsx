import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { useTimer, useTimerElapsedMs } from "../TimerContext";
import { formatElapsedClock } from "../timerLogic";
import { ServicePickerModal } from "./ServicePickerModal";

function TimerChip({
  label,
  icon,
  variant,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  variant: "filled" | "active" | "muted";
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors, spacing, typography } = useTheme();
  const isDisabled = Boolean(disabled || loading);
  const palette =
    variant === "filled"
      ? { background: colors.primary, border: colors.primary, text: colors.textInverse }
      : variant === "active"
        ? { background: colors.card, border: colors.primary, text: colors.primary }
        : { background: colors.card, border: colors.border, text: colors.text };
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: variant === "active" ? 1.5 : 1,
        borderColor: palette.border,
        backgroundColor: palette.background,
        opacity: isDisabled ? 0.6 : pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        {loading ? (
          <ActivityIndicator size="small" color={palette.text} />
        ) : (
          <Feather name={icon} size={13} color={palette.text} />
        )}
        <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function TicketTimerChip({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation("timeEntries");
  const timer = useTimer();
  const elapsedMs = useTimerElapsedMs();
  const [servicePickerOpen, setServicePickerOpen] = useState(false);

  const runningHere =
    timer.status === "running" && timer.session?.work_item_id === ticketId;
  const runningElsewhere = timer.status === "running" && !runningHere;

  const startHere = (service: { service_id: string; service_name: string }) => {
    void timer.start({ workItemId: ticketId, workItemType: "ticket", service });
  };

  if (runningHere) {
    return (
      <TimerChip
        label={t("timer.chip.stop", {
          elapsed: elapsedMs === null ? "" : formatElapsedClock(elapsedMs),
        })}
        icon="stop-circle"
        variant="active"
        onPress={() => timer.openStopModal()}
      />
    );
  }

  if (runningElsewhere) {
    const service = timer.defaultService ??
      (timer.session?.service_id
        ? {
            service_id: timer.session.service_id,
            service_name: timer.session.service_name ?? "",
          }
        : null);
    return (
      <TimerChip
        label={t("timer.chip.switchHere")}
        icon="clock"
        variant="muted"
        onPress={() =>
          timer.openStopModal(
            service
              ? { thenStart: { workItemId: ticketId, workItemType: "ticket", service } }
              : undefined,
          )
        }
      />
    );
  }

  return (
    <>
      <TimerChip
        label={t("timer.chip.start")}
        icon="play"
        variant="filled"
        loading={timer.starting || timer.status === "loading"}
        disabled={timer.starting || timer.status === "loading"}
        onPress={() => {
          if (timer.defaultService) {
            startHere(timer.defaultService);
          } else {
            setServicePickerOpen(true);
          }
        }}
      />
      <ServicePickerModal
        visible={servicePickerOpen}
        client={timer.client}
        apiKey={timer.apiKey}
        onSelect={(service) => {
          setServicePickerOpen(false);
          startHere(service);
        }}
        onClose={() => setServicePickerOpen(false)}
      />
    </>
  );
}
