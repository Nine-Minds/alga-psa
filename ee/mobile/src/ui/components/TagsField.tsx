import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { ApiClient } from "../../api/client";
import type { TagEntityType } from "../../api/tags";
import { TagPickerModal } from "../../features/ticketDetail/components/TagPickerModal";
import { useTheme } from "../ThemeContext";

/** Tag chips with an "Add tags" action; the picker reuses the ticket tag vocabulary UI per entity type. */
export function TagsField({
  label,
  addLabel,
  emptyLabel,
  removeLabel,
  tags,
  onChange,
  entityType,
  client,
  apiKey,
  disabled = false,
  testID,
}: {
  label: string;
  addLabel: string;
  emptyLabel: string;
  removeLabel: (tag: string) => string;
  tags: string[];
  onChange: (tags: string[]) => void;
  entityType: TagEntityType;
  client: ApiClient | null;
  apiKey: string;
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <View testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.xs }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{label}</Text>
        <Pressable
          testID={testID ? `${testID}-add` : undefined}
          onPress={() => setPickerOpen(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          hitSlop={8}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}
        >
          <Feather name="plus" size={14} color={theme.colors.primary} />
          <Text style={{ ...theme.typography.caption, color: theme.colors.primary, fontWeight: "600", marginLeft: 2 }}>{addLabel}</Text>
        </Pressable>
      </View>
      {tags.length === 0 ? (
        <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary }}>{emptyLabel}</Text>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs }}>
          {tags.map((tag) => (
            <Pressable
              key={tag}
              onPress={() => onChange(tags.filter((item) => item !== tag))}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={removeLabel(tag)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: theme.colors.primaryLight,
                opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ ...theme.typography.caption, color: theme.colors.text }}>{tag}</Text>
              <Feather name="x" size={12} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />
            </Pressable>
          ))}
        </View>
      )}
      <TagPickerModal
        visible={pickerOpen}
        updating={false}
        updateError={null}
        appliedTagTexts={tags}
        onApply={(next) => {
          onChange(next);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        client={client}
        apiKey={apiKey}
        ticketUpdate={false}
        entityType={entityType}
      />
    </View>
  );
}
