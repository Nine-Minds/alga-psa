import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { listClients } from "../../../api/clients";
import { listContacts } from "../../../api/contacts";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";
import { useTheme } from "../../../ui/ThemeContext";
import { LogInteractionModal } from "../../opportunities/components/LogInteractionModal";

type Target = { kind: "client"; id: string; label: string } | { kind: "contact"; id: string; label: string };

/**
 * Logging an interaction from the section has no surrounding record, so the
 * user first picks who it is with (a client or a contact), then gets the
 * same dialog the ticket and opportunity screens use.
 */
export function LogInteractionEntry({
  visible,
  client,
  apiKey,
  userId,
  onClose,
  onLogged,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  userId?: string | null;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { t } = useTranslation("interactions");
  const { colors, spacing, typography, borderRadius } = useTheme();
  const [pickKind, setPickKind] = useState<"client" | "contact" | null>(null);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<EntityPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (!visible) {
      setPickKind(null);
      setTarget(null);
      setSearch("");
    }
  }, [visible]);

  useEffect(() => {
    if (!pickKind || !client || !apiKey) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const request = pickKind === "client"
      ? listClients(client, { apiKey, page: 1, limit: 25, search: search || undefined, signal: controller.signal }).then((result) =>
          result.ok ? result.data.data.map((row) => ({ id: row.client_id, label: row.client_name, subtitle: row.email ?? null })) : null)
      : listContacts(client, { apiKey, page: 1, limit: 25, search: search || undefined, signal: controller.signal }).then((result) =>
          result.ok ? result.data.data.map((row) => ({ id: row.contact_name_id, label: row.full_name, subtitle: row.client_name ?? row.email ?? null })) : null);
    void request.then((rows) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!rows) {
        setError(t("logFor.loadFailed"));
        return;
      }
      setItems(rows);
    });
    return () => controller.abort();
  }, [apiKey, client, pickKind, search, t]);

  const choiceStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  };

  return (
    <>
      <Modal visible={visible && !target && !pickKind} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm }}>
          <Text style={{ ...typography.title, color: colors.text, marginBottom: spacing.sm }}>{t("logFor.title")}</Text>
          <Pressable onPress={() => setPickKind("client")} accessibilityRole="button" accessibilityLabel={t("logFor.client")} style={choiceStyle}>
            <Feather name="briefcase" size={18} color={colors.primary} />
            <Text style={{ ...typography.body, color: colors.text, flex: 1 }}>{t("logFor.client")}</Text>
            <Feather name="chevron-right" size={16} color={colors.textSecondary} />
          </Pressable>
          <Pressable onPress={() => setPickKind("contact")} accessibilityRole="button" accessibilityLabel={t("logFor.contact")} style={choiceStyle}>
            <Feather name="user" size={18} color={colors.primary} />
            <Text style={{ ...typography.body, color: colors.text, flex: 1 }}>{t("logFor.contact")}</Text>
            <Feather name="chevron-right" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      </Modal>

      <EntityPickerModal
        visible={visible && pickKind !== null && !target}
        title={pickKind === "contact" ? t("logFor.pickContact") : t("logFor.pickClient")}
        searchPlaceholder={pickKind === "contact" ? t("logFor.searchContacts") : t("logFor.searchClients")}
        emptyLabel={pickKind === "contact" ? t("logFor.noContacts") : t("logFor.noClients")}
        items={items}
        loading={loading}
        error={error}
        searchable
        onSearch={setSearch}
        onSelect={(id, label) => setTarget({ kind: pickKind ?? "client", id, label })}
        onClose={() => setPickKind(null)}
      />

      <LogInteractionModal
        visible={visible && target !== null}
        client={client}
        apiKey={apiKey}
        userId={userId}
        clientId={target?.kind === "client" ? target.id : null}
        contactNameId={target?.kind === "contact" ? target.id : null}
        onClose={onClose}
        onLogged={onLogged}
      />
    </>
  );
}
