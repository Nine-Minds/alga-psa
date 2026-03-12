import { TextInput as RNTextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../ThemeContext";
import { IconButton } from "./IconButton";

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search...",
  onClear,
  autoFocus = false,
  accessibilityLabel = "Search",
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  autoFocus?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  const handleClear = () => {
    onChangeText("");
    onClear?.();
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.card,
        paddingHorizontal: theme.spacing.md,
      }}
    >
      <Feather
        name="search"
        size={18}
        color={theme.colors.textSecondary}
        style={{ marginRight: theme.spacing.sm }}
      />
      <RNTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        accessibilityLabel={accessibilityLabel}
        style={{
          flex: 1,
          ...theme.typography.body,
          color: theme.colors.text,
          paddingVertical: theme.spacing.md,
        }}
      />
      {value.length > 0 ? (
        <IconButton
          icon={<Feather name="x-circle" size={18} color={theme.colors.textSecondary} />}
          onPress={handleClear}
          size={28}
          accessibilityLabel="Clear search"
        />
      ) : null}
    </View>
  );
}
