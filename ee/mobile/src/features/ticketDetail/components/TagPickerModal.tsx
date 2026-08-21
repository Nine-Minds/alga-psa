import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { searchTagSuggestions, type TagSuggestion } from "../../../api/tags";
import type { ApiClient } from "../../../api/client";
import { getTagChipColors } from "../../../ui/tagColors";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";

export function TagPickerModal({
  visible,
  updating,
  updateError,
  appliedTagTexts,
  onApply,
  onClose,
  client,
  apiKey,
  ticketUpdate = true,
}: {
  visible: boolean;
  updating: boolean;
  updateError: string | null;
  appliedTagTexts: string[];
  onApply: (tagTexts: string[]) => void;
  onClose: () => void;
  client: ApiClient | null;
  apiKey: string;
  ticketUpdate?: boolean;
}) {
  const { mode, colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");

  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTagTexts, setSelectedTagTexts] = useState<string[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const appliedTagsKey = appliedTagTexts.join("\u0000");

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!client || !apiKey) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await searchTagSuggestions(client, {
        apiKey,
        search: query,
        limit: 50,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setSuggestions([]);
        setError(t("tags.errors.suggestions", { defaultValue: "Unable to load tags." }));
        return;
      }
      setSuggestions(res.data);
    } catch {
      if (!controller.signal.aborted) {
        setSuggestions([]);
        setError(t("tags.errors.suggestions", { defaultValue: "Unable to load tags." }));
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [client, apiKey, t]);

  useEffect(() => {
    if (visible) {
      setSearch("");
      setSelectedTagTexts(appliedTagsKey ? appliedTagsKey.split("\u0000") : []);
      void fetchSuggestions("");
    } else {
      abortRef.current?.abort();
      setSuggestions([]);
      setError(null);
    }
  }, [visible, fetchSuggestions, appliedTagsKey]);

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void fetchSuggestions(text.trim());
    }, 350);
  };

  const busy = updating;
  const selectedLower = selectedTagTexts.map((text) => text.toLowerCase());
  const isSelected = (text: string) => selectedLower.includes(text.toLowerCase());
  const toggleTag = (tagText: string) => {
    setSelectedTagTexts((current) => {
      const key = tagText.toLowerCase();
      return current.some((text) => text.toLowerCase() === key)
        ? current.filter((text) => text.toLowerCase() !== key)
        : [...current, tagText];
    });
  };
  const trimmedSearch = search.trim();
  const showCreateRow = Boolean(
    trimmedSearch &&
    !isSelected(trimmedSearch) &&
    !suggestions.some((s) => s.tag_text.toLowerCase() === trimmedSearch.toLowerCase()),
  );
  const knownTagTextsLower = new Set([
    ...appliedTagTexts.map((text) => text.toLowerCase()),
    ...suggestions.map((suggestion) => suggestion.tag_text.toLowerCase()),
  ]);
  const visibleTags = Array.from(
    new Map<string, TagSuggestion>([
      // Selected-but-unknown texts (new tags staged via the create row) must
      // stay visible as selected rows; later entries win so known tags keep
      // their server-provided colors.
      ...selectedTagTexts.map((tag_text): [string, TagSuggestion] => [tag_text.toLowerCase(), { tag_text, background_color: null, text_color: null }]),
      ...appliedTagTexts.map((tag_text): [string, TagSuggestion] => [tag_text.toLowerCase(), { tag_text, background_color: null, text_color: null }]),
      ...suggestions.map((suggestion): [string, TagSuggestion] => [suggestion.tag_text.toLowerCase(), suggestion]),
    ]).values(),
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl, maxHeight: "70%", flexShrink: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm }}>
          <Text style={{ ...typography.title, color: colors.text }}>
            {t("tags.pickerTitle", { defaultValue: "Edit tags" })}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common:close")} hitSlop={12}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>{t("common:close")}</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <TextInput
            placeholder={t("tags.searchPlaceholder", { defaultValue: "Search tags…" })}
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={handleSearchChange}
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={50}
            style={{
              ...typography.body,
              color: colors.text,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.card,
            }}
          />
        </View>

        {updateError ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger, marginBottom: spacing.sm }}>
            {updateError}
          </Text>
        ) : null}

        <ScrollView style={{ paddingHorizontal: spacing.lg }} keyboardShouldPersistTaps="handled">
          {showCreateRow ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("tags.createNew", { tag: trimmedSearch, defaultValue: "Add \"{{tag}}\"" })}
              disabled={busy}
              onPress={() => toggleTag(trimmedSearch)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.primary,
                backgroundColor: colors.card,
                opacity: busy ? 0.65 : pressed ? 0.95 : 1,
                marginBottom: spacing.sm,
              })}
            >
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  // Dashed preview: this tag doesn't exist yet.
                  borderStyle: "dashed",
                  borderColor: colors.primary,
                  paddingHorizontal: spacing.md,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                  {trimmedSearch}
                </Text>
              </View>
              <View style={{ flex: 1 }} />
              <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>
                {t("tags.addTag", { defaultValue: "Add tag" })}
              </Text>
              {busy ? <ActivityIndicator size="small" style={{ marginLeft: spacing.sm }} /> : null}
            </Pressable>
          ) : null}

          {loading && visibleTags.length === 0 ? (
            <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
                {t("common:loading")}
              </Text>
            </View>
          ) : error ? (
            <Text style={{ ...typography.caption, color: colors.danger, paddingVertical: spacing.sm }}>
              {error}
            </Text>
          ) : (
            <>
            {visibleTags.length === 0 && !showCreateRow ? (
              <Text style={{ ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm }}>
                {t("tags.noResults", { defaultValue: "No tags found." })}
              </Text>
            ) : null}

            {visibleTags.map((suggestion) => {
              const selected = isSelected(suggestion.tag_text);
              const isNew = !knownTagTextsLower.has(suggestion.tag_text.toLowerCase());
              const chip = getTagChipColors(suggestion, mode);
              const disabled = busy;
              return (
                <Pressable
                  key={suggestion.tag_text.toLowerCase()}
                  accessibilityRole="button"
                  accessibilityLabel={selected
                    ? t("tags.removeTag", { tag: suggestion.tag_text, defaultValue: "Remove tag {{tag}}" })
                    : t("tags.selectTag", { tag: suggestion.tag_text, defaultValue: "Add tag {{tag}}" })}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => toggleTag(suggestion.tag_text)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: colors.card,
                    opacity: disabled ? 0.65 : pressed ? 0.95 : 1,
                    marginBottom: spacing.sm,
                  })}
                >
                  <View
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      // Dashed border marks a tag that doesn't exist yet and
                      // will be created on Apply.
                      borderStyle: isNew ? "dashed" : "solid",
                      borderColor: isNew ? colors.primary : chip.borderColor,
                      backgroundColor: chip.backgroundColor,
                      paddingHorizontal: spacing.md,
                      paddingVertical: 4,
                    }}
                  >
                    <Text style={{ ...typography.caption, color: chip.textColor, fontWeight: "600" }}>
                      {suggestion.tag_text}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  {isNew ? (
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: colors.primary,
                        borderRadius: 999,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "700" }}>
                        {t("tags.newLabel", { defaultValue: "New" })}
                      </Text>
                    </View>
                  ) : selected ? (
                    <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
                      {t("tags.selected", { defaultValue: "Selected" })}
                    </Text>
                  ) : busy ? (
                    <ActivityIndicator size="small" />
                  ) : null}
                </Pressable>
              );
            })}
            </>
          )}
        </ScrollView>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          {ticketUpdate ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm }}>
              {t("tags.notificationsHelper", { defaultValue: "Tag changes do not send ticket notifications." })}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common:cancel")}
              disabled={busy}
              onPress={onClose}
              style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}
            >
              <Text style={{ ...typography.body, color: colors.text, fontWeight: "600" }}>{t("common:cancel")}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                onPress={() => onApply(selectedTagTexts)}
                disabled={busy}
                accessibilityLabel={t("common:apply", { defaultValue: "Apply" })}
              >
                {t("common:apply", { defaultValue: "Apply" })}
              </PrimaryButton>
            </View>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
