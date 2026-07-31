import React from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { useTheme } from "../../../ui/ThemeContext";

export function SegmentChips<T extends string>({
  segments,
  active,
  onChange,
  idPrefix,
}: {
  segments: Array<{ key: T; label: string }>;
  active: T;
  onChange: (key: T) => void;
  idPrefix: string;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}
    >
      {segments.map((segment) => {
        const isActive = segment.key === active;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onChange(segment.key)}
            testID={`${idPrefix}-segment-${segment.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={{
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.borderRadius.md,
              backgroundColor: isActive ? theme.colors.primary : theme.colors.card,
              borderWidth: 1,
              borderColor: isActive ? theme.colors.primary : theme.colors.border,
            }}
          >
            <Text
              style={{
                ...theme.typography.caption,
                fontWeight: "600",
                color: isActive ? theme.colors.textInverse : theme.colors.text,
              }}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
