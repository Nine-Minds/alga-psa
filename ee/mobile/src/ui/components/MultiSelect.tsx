import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../ThemeContext";
import { BottomSheet } from "./BottomSheet";
import { ListRow } from "./ListRow";
import type { SelectOption } from "./Select";

export type MultiSelectProps<T> = {
  values: T[];
  options: SelectOption<T>[];
  onToggle: (value: T) => void;
  visible: boolean;
  onClose: () => void;
  title?: string;
  loading?: boolean;
  error?: string;
};

/** Bottom-sheet picker that keeps the sheet open while several options are toggled. */
export function MultiSelect<T>({ values, options, onToggle, visible, onClose, title, loading = false, error }: MultiSelectProps<T>) {
  const theme = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} snapPoint="half">
      {loading ? (
        <View style={{ padding: theme.spacing.xl, alignItems: "center" }}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={{ padding: theme.spacing.xl, alignItems: "center" }}>
          <Text style={{ ...theme.typography.body, color: theme.colors.danger }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={options}
          keyExtractor={(_item, index) => String(index)}
          scrollEnabled={false}
          renderItem={({ item }) => {
            const isSelected = values.includes(item.value);
            return (
              <ListRow
                title={item.label}
                subtitle={item.subtitle}
                selected={isSelected}
                disabled={item.disabled}
                accessibilityLabel={`${item.label}: ${isSelected ? "selected" : "not selected"}`}
                onPress={() => onToggle(item.value)}
                rightContent={
                  <Feather name={isSelected ? "check-square" : "square"} size={18} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
                }
              />
            );
          }}
        />
      )}
    </BottomSheet>
  );
}
