import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TicketCategory } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";
import { groupTicketCategories } from "../ticketCategory";
import {
  activeTicketNotificationSuppression,
  DEFAULT_TICKET_NOTIFICATION_SUPPRESSION,
  TicketUpdateFooter,
} from "./TicketUpdateFooter";

export function CategoryPickerModal({
  visible,
  loading,
  error,
  categories,
  currentCategoryId,
  updating,
  updateError,
  onApply,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  categories: TicketCategory[];
  /** The subcategory when the ticket has one, else the category. */
  currentCategoryId: string | null;
  updating: boolean;
  updateError: string | null;
  onApply: (
    categoryId: string | null,
    notificationSuppression: ReturnType<typeof activeTicketNotificationSuppression>,
  ) => void;
  onClose: () => void;
}) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useTranslation("tickets");
  const busy = loading || updating;
  const [selectedId, setSelectedId] = useState<string | null>(currentCategoryId);
  const [search, setSearch] = useState("");
  const [suppression, setSuppression] = useState(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);

  useEffect(() => {
    if (!visible) return;
    setSelectedId(currentCategoryId);
    setSearch("");
    setSuppression(DEFAULT_TICKET_NOTIFICATION_SUPPRESSION);
  }, [currentCategoryId, visible]);

  const groups = useMemo(() => {
    const all = groupTicketCategories(categories);
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all
      .map((group) => {
        const children = group.children.filter((child) => child.category_name.toLowerCase().includes(term));
        const parentMatches = group.parent.category_name.toLowerCase().includes(term);
        if (parentMatches) return { ...group };
        return { parent: group.parent, children };
      })
      .filter((group) => group.children.length > 0 || group.parent.category_name.toLowerCase().includes(term));
  }, [categories, search]);

  const row = (category: TicketCategory, isChild: boolean) => {
    const isSelected = category.category_id === selectedId;
    return (
      <Pressable
        key={category.category_id}
        testID={`ticket-category-option-${category.category_id}`}
        accessibilityRole="button"
        accessibilityLabel={t("categoryPicker.setCategory", { name: category.category_name })}
        disabled={busy}
        onPress={() => setSelectedId(isSelected ? null : category.category_id)}
        style={({ pressed }) => ({
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          marginLeft: isChild ? spacing.lg : 0,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: isSelected ? colors.primary : colors.border,
          backgroundColor: colors.card,
          opacity: busy ? 0.65 : pressed ? 0.95 : 1,
          marginBottom: spacing.sm,
        })}
      >
        <Text style={{ ...typography.body, color: colors.text }}>
          {category.category_name}
          {isSelected ? " ✓" : ""}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
        <Text style={{ ...typography.title, color: colors.text }}>{t("categoryPicker.title")}</Text>
        <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }}>
          {t("categoryPicker.hint")}
        </Text>
        {busy ? (
          <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ ...typography.caption, marginTop: spacing.sm, color: colors.textSecondary }}>
              {loading ? t("common:loading") : t("common:saving")}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>{error}</Text>
        ) : null}
        {updateError ? (
          <Text style={{ ...typography.caption, marginTop: spacing.md, color: colors.danger }}>{updateError}</Text>
        ) : null}

        {categories.length > 0 ? (
          <TextInput
            testID="ticket-category-search"
            value={search}
            onChangeText={setSearch}
            placeholder={t("categoryPicker.searchPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            style={{
              marginTop: spacing.md,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              color: colors.text,
            }}
          />
        ) : null}

        <ScrollView style={{ marginTop: spacing.md }} keyboardShouldPersistTaps="handled">
          {!loading && categories.length === 0 && !error ? (
            <Text style={{ ...typography.caption, color: colors.textSecondary }}>
              {t("categoryPicker.empty")}
            </Text>
          ) : null}
          {groups.map((group) => (
            <View key={group.parent.category_id}>
              {row(group.parent, false)}
              {group.children.map((child) => row(child, true))}
            </View>
          ))}
        </ScrollView>

        <TicketUpdateFooter
          suppression={suppression}
          onSuppressionChange={setSuppression}
          onCancel={onClose}
          onApply={() => onApply(selectedId, activeTicketNotificationSuppression(suppression))}
          applyLabel={t("categoryPicker.apply")}
          applyDisabled={selectedId === currentCategoryId}
          busy={busy}
        />
      </View>
    </Modal>
  );
}
