import React from "react";
import { Alert, Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { copyToClipboard } from "../../../clipboard/clipboard";
import { buildTicketWebUrl } from "../../../urls/hostedUrls";
import { ActionChip } from "./ActionChip";

export function TicketActions({
  baseUrl,
  ticketId,
  ticketNumber,
}: {
  baseUrl: string | null;
  ticketId: string;
  ticketNumber: string;
}) {
  const { spacing } = useTheme();
  const { t } = useTranslation("tickets");
  const openInWebUrl = baseUrl ? buildTicketWebUrl(baseUrl, ticketId) : null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md, gap: spacing.sm }}>
      <ActionChip
        label={t("detail.copyNumber")}
        onPress={() => {
          void (async () => {
            const res = await copyToClipboard("ticket_number", ticketNumber);
            Alert.alert(t("common:copied"), res.copiedText);
          })();
        }}
      />
      <ActionChip
        label={t("detail.copyId")}
        onPress={() => {
          void (async () => {
            const res = await copyToClipboard("ticket_id", ticketId);
            Alert.alert(t("common:copied"), res.copiedText);
          })();
        }}
      />
      {openInWebUrl ? (
        <>
          <ActionChip
            label={t("detail.openInWeb")}
            onPress={() => {
              Alert.alert(t("detail.openInWebConfirm"), openInWebUrl, [
                { text: t("common:cancel"), style: "cancel" },
                { text: t("common:open"), onPress: () => void Linking.openURL(openInWebUrl) },
              ]);
            }}
          />
        </>
      ) : null}
    </View>
  );
}
