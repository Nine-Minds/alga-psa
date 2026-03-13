import { View } from "react-native";
import { useTheme } from "../ThemeContext";

export function Separator({
  orientation = "horizontal",
  line = false,
  spacing,
}: {
  orientation?: "horizontal" | "vertical";
  line?: boolean;
  spacing?: number;
}) {
  const theme = useTheme();
  const size = spacing ?? theme.spacing.sm;

  if (orientation === "vertical") {
    return (
      <View
        style={
          line
            ? { width: 1, backgroundColor: theme.colors.border, marginHorizontal: size }
            : { width: size }
        }
      />
    );
  }

  return (
    <View
      style={
        line
          ? { height: 1, backgroundColor: theme.colors.border, marginVertical: size }
          : { height: size }
      }
    />
  );
}
