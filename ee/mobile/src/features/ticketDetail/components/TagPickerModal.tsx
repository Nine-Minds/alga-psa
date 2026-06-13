import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { searchTagSuggestions, type TagSuggestion } from "../../../api/tags";
import type { ApiClient } from "../../../api/client";
import { getTagChipColors } from "../../../ui/tagColors";

export function TagPickerModal({
  visible,
  updating,
  updateError,
  appliedTagTexts,
  onSelect,
  onClose,
  client,
  apiKey,
}: {
  visible: boolean;
  updating: boolean;
  updateError: string | null;
  appliedTagTexts: string[];
  onSelect: (tagText: string) => void;
  onClose: () => void;
  client: ApiClient | null;
  apiKey: string;
}) {
  const { mode, colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");

  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
      void fetchSuggestions("");
    } else {
      abortRef.current?.abort();
      setSuggestions([]);
      setError(null);
    }
  }, [visible, fetchSuggestions]);

  const handleSearchChange = (text: string) => {
    setSearch(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void fetchSuggestions(text.trim());
    }, 350);
  };

  const busy = updating;
  const appliedLower = appliedTagTexts.map((text) => text.toLowerCase());
  const isApplied = (text: string) => appliedLower.includes(text.toLowerCase());
  const trimmedSearch = search.trim();
  const showCreateRow = Boolean(
    trimmedSearch &&
    !isApplied(trimmedSearch) &&
    !suggestions.some((s) => s.tag_text.toLowerCase() === trimmedSearch.toLowerCase()),
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
            {t("tags.pickerTitle", { defaultValue: "Add tag" })}
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
              onPress={() => onSelect(trimmedSearch)}
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
              <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600", flex: 1 }}>
                {t("tags.createNew", { tag: trimmedSearch, defaultValue: "Add \"{{tag}}\"" })}
              </Text>
              {busy ? <ActivityIndicator size="small" /> : null}
            </Pressable>
          ) : null}

          {loading && suggestions.length === 0 ? (
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
            {suggestions.length === 0 && !showCreateRow ? (
              <Text style={{ ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm }}>
                {t("tags.noResults", { defaultValue: "No tags found." })}
              </Text>
            ) : null}

            {suggestions.map((suggestion) => {
              const applied = isApplied(suggestion.tag_text);
              const chip = getTagChipColors(suggestion, mode);
              const disabled = busy || applied;
              return (
                <Pressable
                  key={suggestion.tag_text.toLowerCase()}
                  accessibilityRole="button"
                  accessibilityLabel={t("tags.selectTag", { tag: suggestion.tag_text, defaultValue: "Add tag {{tag}}" })}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => onSelect(suggestion.tag_text)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    opacity: disabled ? 0.65 : pressed ? 0.95 : 1,
                    marginBottom: spacing.sm,
                  })}
                >
                  <View
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: chip.borderColor,
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
                  {applied ? (
                    <Text style={{ ...typography.caption, color: colors.textSecondary }}>
                      {t("tags.alreadyAdded", { defaultValue: "Added" })}
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
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
