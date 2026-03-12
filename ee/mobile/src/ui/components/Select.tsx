import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";
import { BottomSheet } from "./BottomSheet";
import { ListRow } from "./ListRow";
import { Feather } from "@expo/vector-icons";

export type SelectOption<T> = {
  label: string;
  value: T;
  subtitle?: string;
  disabled?: boolean;
};

export type SelectProps<T> = {
  value: T | null;
  options: SelectOption<T>[];
  onSelect: (value: T) => void;
  visible: boolean;
  onClose: () => void;
  title?: string;
  loading?: boolean;
  error?: string;
};

export function Select<T>({
  value,
  options,
  onSelect,
  visible,
  onClose,
  title,
  loading = false,
  error,
}: SelectProps<T>) {
  const theme = useTheme();

  const renderItem = ({ item }: { item: SelectOption<T> }) => {
    const isSelected = item.value === value;
    return (
      <ListRow
        title={item.label}
        subtitle={item.subtitle}
        selected={isSelected}
        disabled={item.disabled}
        onPress={() => {
          onSelect(item.value);
          onClose();
        }}
        rightContent={
          isSelected ? (
            <Feather name="check" size={18} color={theme.colors.primary} />
          ) : null
        }
      />
    );
  };

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
          renderItem={renderItem}
          scrollEnabled={false}
        />
      )}
    </BottomSheet>
  );
}
