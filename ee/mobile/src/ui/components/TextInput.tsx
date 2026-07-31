import type { ReactNode } from "react";
import type { KeyboardTypeOptions } from "react-native";
import { Text, TextInput as RNTextInput, View } from "react-native";
import { useTheme } from "../ThemeContext";

export type NumericMode = "integer" | "signed" | "decimal" | "signedDecimal";

// iPads present a full keyboard regardless of keyboardType, so numeric fields
// must sanitize what they accept rather than trust the keyboard layout.
export function sanitizeNumericText(text: string, mode: NumericMode): string {
  if (mode === "integer") return text.replace(/[^0-9]/g, "");
  if (mode === "signed") {
    const negative = text.trimStart().startsWith("-");
    const digits = text.replace(/[^0-9]/g, "");
    return negative ? `-${digits}` : digits;
  }
  const negative = mode === "signedDecimal" && text.trimStart().startsWith("-");
  const normalized = text.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const [head, ...rest] = normalized.split(".");
  const digits = rest.length > 0 ? `${head}.${rest.join("")}` : head;
  return negative ? `-${digits}` : digits;
}

const NUMERIC_KEYBOARDS: Record<NumericMode, KeyboardTypeOptions> = {
  integer: "number-pad",
  signed: "numbers-and-punctuation",
  decimal: "decimal-pad",
  signedDecimal: "numbers-and-punctuation",
};

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
  numericMode,
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
  /** Restrict input to numbers; also picks a matching keyboard when keyboardType is not set. */
  numericMode?: NumericMode;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  accessibilityLabel?: string;
  rightElement?: ReactNode;
}) {
  const theme = useTheme();
  const hasError = Boolean(error);
  const handleChangeText = numericMode
    ? (text: string) => onChangeText(sanitizeNumericText(text, numericMode))
    : onChangeText;
  const effectiveKeyboardType = keyboardType ?? (numericMode ? NUMERIC_KEYBOARDS[numericMode] : undefined);

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
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.placeholder}
          editable={!disabled}
          multiline={multiline}
          keyboardType={effectiveKeyboardType}
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
