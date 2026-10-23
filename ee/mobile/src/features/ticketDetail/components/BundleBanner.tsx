import React from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TicketBundleMember, TicketBundleView } from "../../../api/tickets";
import type { TicketBundleRole } from "../../../screens/ticketsBundle";
import { useTheme } from "../../../ui/ThemeContext";

/**
 * Web parity for bundle membership: children get an amber "bundled under"
 * banner (workflow fields locked), masters get a panel listing their children
 * and the sync mode. Tapping a member opens that ticket.
 */
export function BundleBanner({
  role,
  bundle,
  masterTicketNumber,
  childCount,
  onOpenTicket,
}: {
  role: TicketBundleRole;
  bundle: TicketBundleView | null;
  masterTicketNumber: string | null;
  childCount: number;
  onOpenTicket?: (ticketId: string) => void;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography, borderRadius } = useTheme();

  if (role === "standalone") return null;

  if (role === "child") {
    const masterId = bundle?.master?.ticket_id ?? bundle?.master_ticket_id ?? null;
    const masterNumber = bundle?.master?.ticket_number ?? masterTicketNumber ?? t("detail.bundle.master", "master");
    const palette = colors.badge.warning;
    return (
      <Pressable
        onPress={masterId && onOpenTicket ? () => onOpenTicket(masterId) : undefined}
        disabled={!masterId || !onOpenTicket}
        accessibilityRole="button"
        accessibilityLabel={t("detail.bundle.openMaster", { number: masterNumber, defaultValue: "Open master ticket {{number}}" })}
        testID="ticket-bundle-child-banner"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          padding: spacing.md,
          borderRadius: borderRadius.lg,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.bg,
        }}
      >
        <Feather name="link" size={16} color={palette.text} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.body, color: palette.text }}>
            {t("detail.bundle.childBanner", { number: masterNumber, defaultValue: "This ticket is bundled under {{number}}." })}
          </Text>
          <Text style={{ ...typography.caption, color: palette.text, marginTop: 2 }}>
            {t("detail.bundle.locked", "Status, priority and assignee are locked; work from the master ticket.")}
          </Text>
        </View>
        {masterId ? <Feather name="chevron-right" size={16} color={palette.text} /> : null}
      </Pressable>
    );
  }

  const palette = colors.badge.info;
  const children: TicketBundleMember[] = bundle?.children ?? [];
  const count = children.length > 0 ? children.length : childCount;
  const mode = bundle?.settings?.mode ?? "sync_updates";
  return (
    <View
      testID="ticket-bundle-master-panel"
      style={{
        padding: spacing.md,
        borderRadius: borderRadius.lg,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.bg,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Feather name="layers" size={16} color={palette.text} />
        <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>
          {t("detail.bundle.masterBanner", { count, defaultValue: "Master of a bundle ({{count}} children)." })}
        </Text>
      </View>
      <Text style={{ ...typography.caption, color: palette.text }}>
        {t("detail.bundle.mode", {
          mode: t(`detail.bundle.modes.${mode}`, mode === "link_only" ? "Link only" : "Sync updates"),
          defaultValue: "Mode: {{mode}}",
        })}
        {mode === "sync_updates"
          ? ` · ${t("detail.bundle.syncHint", "Status, priority and assignee changes flow to the children.")}`
          : ""}
      </Text>
      {children.map((child) => (
        <Pressable
          key={child.ticket_id}
          onPress={onOpenTicket ? () => onOpenTicket(child.ticket_id) : undefined}
          disabled={!onOpenTicket}
          accessibilityRole="button"
          accessibilityLabel={t("list.ticketAccessibility", { number: child.ticket_number, title: child.title })}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingVertical: spacing.xs,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>{child.ticket_number}</Text>
          <Text numberOfLines={1} style={{ ...typography.caption, color: palette.text, flex: 1 }}>
            {child.title}
          </Text>
          <Feather name="chevron-right" size={14} color={palette.text} />
        </Pressable>
      ))}
    </View>
  );
}
