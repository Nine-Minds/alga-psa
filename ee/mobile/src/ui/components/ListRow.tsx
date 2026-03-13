import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

export function ListRow({
  title,
  subtitle,
  leftContent,
  rightContent,
  onPress,
  disabled = false,
  selected = false,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  leftContent?: ReactNode;
  rightContent?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        borderLeftWidth: selected ? 3 : 0,
        borderLeftColor: selected ? theme.colors.primary : "transparent",
        backgroundColor: selected ? theme.colors.borderLight : "transparent",
      }}
    >
      {leftContent ? (
        <View style={{ marginRight: theme.spacing.md }}>{leftContent}</View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            ...theme.typography.body,
            color: disabled ? theme.colors.textSecondary : theme.colors.text,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              ...theme.typography.caption,
              color: theme.colors.textSecondary,
              marginTop: theme.spacing.xxs,
            }}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightContent ? (
        <View style={{ marginLeft: theme.spacing.md }}>{rightContent}</View>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        style={({ pressed }) => ({
          opacity: pressed && !disabled ? 0.7 : disabled ? 0.5 : 1,
        })}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessibilityLabel={accessibilityLabel ?? title}>{content}</View>
  );
}
