import { useCallback } from "react";
import { Linking } from "react-native";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../ui/toast/ToastProvider";
import { recordPendingCall, type PendingCall } from "./usePendingCallPrompt";

export type PlaceCallInput = Omit<PendingCall, "startedAtMs">;

/**
 * Dial a number and arm the "log this call?" prompt for the originating screen.
 * The record is written only once the dialer actually opens: on devices that
 * can't place calls (wifi-only iPads) it would otherwise fire on the next
 * unrelated app resume.
 */
export function usePlaceCall(): (call: PlaceCallInput) => void {
  const { t } = useTranslation("interactions");
  const { showToast } = useToast();

  return useCallback(
    (call: PlaceCallInput) => {
      const startedAtMs = Date.now();
      Linking.openURL(`tel:${call.phone}`)
        .then(() => recordPendingCall({ ...call, startedAtMs }))
        .catch(() => {
          showToast({ message: t("callPrompt.unavailable", "This device can't place phone calls."), tone: "error" });
        });
    },
    [showToast, t],
  );
}
