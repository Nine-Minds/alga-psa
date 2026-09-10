import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { getClientNotes, saveClientNotes } from "../../../api/clients";
import { logger } from "../../../logging/logger";
import { Card } from "../../../ui/components/Card";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { TextInput } from "../../../ui/components/TextInput";
import { useTheme } from "../../../ui/ThemeContext";
import { appendNoteBlock, blockDataToText } from "../../assets/blockNote";
import { SectionCollapseToggle } from "../../ticketDetail/components/SectionCollapseToggle";

/**
 * Client notes (the rich-text notes document from the web client page, plus
 * legacy plain-text notes) rendered read-only as flattened text. Used on the
 * ticket screen so dispatched techs see what the team knows about the client,
 * and on the client screen where a note can also be appended.
 */
export function ClientNotesSection({
  client,
  apiKey,
  clientId,
  legacyNotes = null,
  titleKey = "notes.title",
  canAdd = false,
  initiallyCollapsed = false,
  collapseWhenEmpty = false,
}: {
  client: ApiClient | null;
  apiKey: string;
  clientId: string;
  legacyNotes?: string | null;
  titleKey?: string;
  canAdd?: boolean;
  initiallyCollapsed?: boolean;
  collapseWhenEmpty?: boolean;
}) {
  const { t } = useTranslation("clients");
  const { colors, spacing, typography, borderRadius } = useTheme();
  const [blockData, setBlockData] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const autoCollapsedRef = useRef(false);

  const notesText = useMemo(() => blockDataToText(blockData), [blockData]);
  const legacyText = legacyNotes?.trim() ?? "";
  const title = t(titleKey);

  const load = useCallback(async () => {
    if (!client || !apiKey) return;
    setError(null);
    const result = await getClientNotes(client, { apiKey, clientId });
    if (!result.ok) {
      if (result.error.kind === "canceled") return;
      logger.warn("[ClientNotesSection] load failed", { error: result.error });
      setError(t("notes.loadFailed"));
      setLoading(false);
      return;
    }
    const nextBlockData = result.data.data?.blockData ?? null;
    setBlockData(nextBlockData);
    setLoading(false);
    if (collapseWhenEmpty && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true;
      if (!blockDataToText(nextBlockData) && !legacyText) setCollapsed(true);
    }
  }, [apiKey, client, clientId, collapseWhenEmpty, legacyText, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitNote = useCallback(async () => {
    const note = noteDraft.trim();
    if (!client || !apiKey || !note) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveClientNotes(client, {
      apiKey,
      clientId,
      blockData: appendNoteBlock(blockData, note),
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error.message || t("notes.saveFailed"));
      return;
    }
    setNoteOpen(false);
    setNoteDraft("");
    await load();
  }, [apiKey, blockData, client, clientId, load, noteDraft, t]);

  return (
    <Card accessibilityLabel={title}>
      <SectionHeader
        title={title}
        action={(
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {canAdd && !collapsed ? (
              <Pressable
                onPress={() => { setNoteDraft(""); setSaveError(null); setNoteOpen(true); }}
                accessibilityRole="button"
                accessibilityLabel={t("notes.add")}
                hitSlop={8}
              >
                <Text style={{ ...typography.body, color: colors.primary }}>{t("notes.add")}</Text>
              </Pressable>
            ) : null}
            <SectionCollapseToggle
              collapsed={collapsed}
              onToggle={() => setCollapsed((value) => !value)}
              sectionLabel={title}
            />
          </View>
        )}
      />

      {collapsed ? null : (
        <View style={{ marginTop: spacing.sm }}>
          {loading ? (
            <View style={{ alignItems: "center", paddingVertical: spacing.sm }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : error ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={{ ...typography.caption, color: colors.danger, flex: 1 }}>{error}</Text>
              <Pressable
                onPress={() => { setLoading(true); void load(); }}
                accessibilityRole="button"
                accessibilityLabel={t("notes.retry")}
                hitSlop={8}
              >
                <Text style={{ ...typography.body, color: colors.primary }}>{t("notes.retry")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {notesText ? (
                <Text testID="client-notes-body" style={{ ...typography.body, color: colors.text }}>
                  {notesText}
                </Text>
              ) : null}
              {legacyText ? (
                <View style={{ marginTop: notesText ? spacing.sm : 0 }}>
                  <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("notes.legacyLabel")}</Text>
                  <Text testID="client-notes-legacy" style={{ ...typography.body, color: colors.text, marginTop: 2 }}>
                    {legacyText}
                  </Text>
                </View>
              ) : null}
              {!notesText && !legacyText ? (
                <Text style={{ ...typography.body, color: colors.textSecondary }}>{t("notes.empty")}</Text>
              ) : null}
            </>
          )}
        </View>
      )}

      {noteOpen ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setNoteOpen(false)}>
          <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: "rgba(0,0,0,0.45)" }}>
            <View style={{ backgroundColor: colors.card, borderRadius: borderRadius.md, padding: spacing.lg, gap: spacing.md }}>
              <Text style={{ ...typography.title, color: colors.text }}>{t("notes.addTitle")}</Text>
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                label={t("notes.label")}
                placeholder={t("notes.placeholder")}
                multiline
                accessibilityLabel="client-note-input"
              />
              {saveError ? (
                <Text style={{ ...typography.caption, color: colors.danger }}>{saveError}</Text>
              ) : null}
              <PrimaryButton
                onPress={() => void submitNote()}
                disabled={saving || noteDraft.trim().length === 0}
                accessibilityLabel="client-note-submit"
              >
                {t("notes.save")}
              </PrimaryButton>
              <Pressable
                onPress={() => setNoteOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t("common:cancel")}
                hitSlop={8}
              >
                <Text style={{ ...typography.body, color: colors.textSecondary, textAlign: "center", padding: spacing.xs }}>
                  {t("common:cancel")}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </Card>
  );
}
