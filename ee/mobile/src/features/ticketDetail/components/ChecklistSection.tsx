import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TicketChecklistItem } from "../../../api/ticketChecklist";
import { Card } from "../../../ui/components/Card";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { useTheme } from "../../../ui/ThemeContext";
import { formatDateTimeWithRelative } from "../../../ui/formatters/dateTime";
import { ActionChip } from "./ActionChip";
import { SectionCollapseToggle } from "./SectionCollapseToggle";

export function ChecklistSection({
  items,
  loading,
  hidden,
  error,
  actionError,
  adding,
  updatingIds,
  onAdd,
  onToggle,
  initiallyCollapsed = false,
}: {
  items: TicketChecklistItem[];
  loading: boolean;
  hidden: boolean;
  error: string | null;
  actionError: string | null;
  adding: boolean;
  updatingIds: Set<string>;
  onAdd: (name: string, isRequired: boolean) => Promise<boolean>;
  onToggle: (item: TicketChecklistItem) => void;
  initiallyCollapsed?: boolean;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();
  const [addingOpen, setAddingOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [required, setRequired] = useState(false);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  if (hidden) return null;
  const completedCount = items.filter((item) => item.completed).length;

  return (
    <Card accessibilityLabel={t("checklist.title", "Checklist")}>
      <SectionHeader
        title={t("checklist.title", "Checklist")}
        action={(
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {!collapsed ? (
              <ActionChip
                label={addingOpen ? t("common:cancel") : t("checklist.add", "Add item")}
                disabled={adding}
                onPress={() => setAddingOpen((value) => !value)}
              />
            ) : null}
            <SectionCollapseToggle
              collapsed={collapsed}
              onToggle={() => setCollapsed((value) => !value)}
              summary={`${completedCount}/${items.length}`}
              sectionLabel={t("checklist.title", "Checklist")}
            />
          </View>
        )}
      />

      {collapsed ? null : <>
      {loading ? (
        <View style={{ paddingVertical: spacing.md, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>{error}</Text>
      ) : items.length === 0 ? (
        <Text style={{ ...typography.body, color: colors.textSecondary, marginTop: spacing.md }}>
          {t("checklist.empty", "No checklist items.")}
        </Text>
      ) : (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {items.map((item) => {
            const updating = updatingIds.has(item.checklist_item_id);
            return (
              <Pressable
                key={item.checklist_item_id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.completed, disabled: updating }}
                accessibilityLabel={item.completed
                  ? t("checklist.markIncomplete", "Mark {{name}} incomplete", { name: item.item_name })
                  : t("checklist.markComplete", "Complete {{name}}", { name: item.item_name })}
                disabled={updating}
                onPress={() => onToggle(item)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: spacing.sm,
                  padding: spacing.sm,
                  borderWidth: 1,
                  borderColor: item.is_required && !item.completed ? colors.danger : colors.border,
                  borderRadius: 10,
                  opacity: updating ? 0.55 : pressed ? 0.85 : 1,
                })}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: item.completed ? colors.primary : colors.border,
                    backgroundColor: item.completed ? colors.primary : colors.card,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.completed ? <Text style={{ color: colors.textInverse, fontWeight: "700" }}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs }}>
                    <Text
                      style={{
                        ...typography.body,
                        color: item.completed ? colors.textSecondary : colors.text,
                        textDecorationLine: item.completed ? "line-through" : "none",
                        flexShrink: 1,
                      }}
                    >
                      {item.item_name}
                    </Text>
                    {item.is_required ? (
                      <Text style={{ ...typography.caption, color: item.completed ? colors.textSecondary : colors.danger, fontWeight: "700" }}>
                        {t("checklist.required", "Required")}
                      </Text>
                    ) : null}
                  </View>
                  {item.description ? (
                    <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>{item.description}</Text>
                  ) : null}
                  {item.completed && (item.completed_by_name || item.completed_at) ? (
                    <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                      {t("checklist.completedBy", "Completed{{by}}{{at}}", {
                        by: item.completed_by_name ? ` by ${item.completed_by_name}` : "",
                        at: item.completed_at ? ` · ${formatDateTimeWithRelative(item.completed_at)}` : "",
                      })}
                    </Text>
                  ) : null}
                </View>
                {updating ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {addingOpen ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("checklist.placeholder", "Checklist item")}
            placeholderTextColor={colors.textSecondary}
            maxLength={255}
            editable={!adding}
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
          <ActionChip
            label={required ? t("checklist.requiredChecked", "Required ✓") : t("checklist.required", "Required")}
            disabled={adding}
            onPress={() => setRequired((value) => !value)}
          />
          <View style={{ alignSelf: "flex-end" }}>
            <PrimaryButton
              accessibilityLabel={t("checklist.add", "Add item")}
              disabled={adding || draft.trim().length === 0}
              onPress={() => {
                void onAdd(draft, required).then((added) => {
                  if (added) {
                    setDraft("");
                    setRequired(false);
                    setAddingOpen(false);
                  }
                });
              }}
            >
              {adding ? t("checklist.adding", "Adding…") : t("checklist.add", "Add item")}
            </PrimaryButton>
          </View>
        </View>
      ) : null}

      {actionError ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>{actionError}</Text>
      ) : null}
      </>}
    </Card>
  );
}
