import type { ReactNode } from "react";
import type { KeyboardTypeOptions } from "react-native";
import { Text, TextInput as RNTextInput, View } from "react-native";
import { useTheme } from "../ThemeContext";

export function TextInput({
  value,
  onChangeText,
  label,
  placeholder,
  error,
  helperText,
  disabled = false,
  multiline = false,
  minHeight,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  accessibilityLabel,
  rightElement,
}: {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  multiline?: boolean;
  minHeight?: number;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  accessibilityLabel?: string;
  rightElement?: ReactNode;
}) {
  const theme = useTheme();
  const hasError = Boolean(error);

  return (
    <View>
      {label ? (
        <Text
          style={{
            ...theme.typography.caption,
            color: theme.colors.textSecondary,
            marginBottom: theme.spacing.xs,
          }}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: hasError ? theme.colors.danger : theme.colors.border,
          borderRadius: theme.borderRadius.md,
          backgroundColor: disabled ? theme.colors.borderLight : theme.colors.card,
          paddingHorizontal: theme.spacing.md,
        }}
      >
        <RNTextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.placeholder}
          editable={!disabled}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          accessibilityLabel={accessibilityLabel ?? label}
          style={[
            {
              flex: 1,
              ...theme.typography.body,
              color: disabled ? theme.colors.textSecondary : theme.colors.text,
              paddingVertical: theme.spacing.md,
            },
            multiline && minHeight ? { minHeight, textAlignVertical: "top" } : undefined,
          ]}
        />
        {rightElement ?? null}
      </View>
      {hasError ? (
        <Text
          style={{
            ...theme.typography.caption,
            color: theme.colors.danger,
            marginTop: theme.spacing.xs,
          }}
        >
          {error}
        </Text>
      ) : helperText ? (
        <Text
          style={{
            ...theme.typography.caption,
            color: theme.colors.textSecondary,
            marginTop: theme.spacing.xs,
          }}
        >
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}
