import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../ThemeContext";

/** The round "+" that sits in a navigation header and opens a create flow. */
export function HeaderAddButton({
  onPress,
  accessibilityLabel,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.colors.primary,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name="plus" size={20} color={theme.colors.textInverse} />
    </Pressable>
  );
}
