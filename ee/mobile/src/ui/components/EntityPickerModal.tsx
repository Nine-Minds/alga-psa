import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ThemeContext";
import { Avatar } from "./Avatar";

export type EntityPickerItem = {
  id: string;
  label: string;
  subtitle?: string | null;
  imageUri?: string | null;
};

export function EntityPickerModal({
  visible,
  title,
  searchPlaceholder,
  emptyLabel,
  items,
  loading,
  error,
  searchable = true,
  selectedId,
  authToken = undefined,
  onSearch,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  items: EntityPickerItem[];
  loading: boolean;
  error: string | null;
  searchable?: boolean;
  selectedId?: string | null;
  authToken?: string;
  onSearch?: (query: string) => void;
  onSelect: (id: string, label: string) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("common");
  const [search, setSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setSearch("");
    }
  }, [visible]);

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    if (!onSearch) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      onSearch(text.trim());
    }, 350);
  }, [onSearch]);

  // Deduplicate by id, then optionally filter locally
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [items]);

  const filtered = onSearch ? deduped : deduped.filter((item) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return item.label.toLowerCase().includes(q) || (item.subtitle?.toLowerCase().includes(q) ?? false);
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl, maxHeight: "70%" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm }}>
          <Text style={{ ...typography.title, color: colors.text }}>{title}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("close")} hitSlop={12}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>{t("close")}</Text>
          </Pressable>
        </View>

        {searchable ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
            <TextInput
              placeholder={searchPlaceholder ?? t("search")}
              placeholderTextColor={colors.textSecondary}
              value={search}
              onChangeText={handleSearchChange}
              autoCorrect={false}
              autoCapitalize="none"
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
        ) : null}

        {loading && items.length === 0 ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {t("loading")}
            </Text>
          </View>
        ) : error ? (
          <Text style={{ ...typography.caption, paddingHorizontal: spacing.lg, color: colors.danger }}>
            {error}
          </Text>
        ) : (
          <ScrollView style={{ paddingHorizontal: spacing.lg }} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 && !loading ? (
              <Text style={{ ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm }}>
                {emptyLabel ?? t("noResults")}
              </Text>
            ) : null}
            {filtered.map((item, idx) => {
              const isSelected = selectedId === item.id;
              return (
                <Pressable
                  key={`${item.id}-${idx}`}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => onSelect(item.id, item.label)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.primary : colors.border,
                    backgroundColor: isSelected ? (colors.primaryLight ?? colors.card) : colors.card,
                    opacity: pressed ? 0.95 : 1,
                    marginBottom: spacing.sm,
                  })}
                >
                  {item.imageUri !== undefined ? (
                    <View style={{ marginRight: spacing.sm }}>
                      <Avatar name={item.label} imageUri={item.imageUri ?? undefined} authToken={authToken} size="sm" />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.body, color: colors.text }}>
                      {item.label}{isSelected ? " \u2713" : ""}
                    </Text>
                    {item.subtitle ? (
                      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
