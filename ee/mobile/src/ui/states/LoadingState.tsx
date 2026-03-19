import { ActivityIndicator, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.spacing.xl,
        backgroundColor: theme.colors.background,
      }}
    >
      <ActivityIndicator color={theme.colors.primary} />
      <Text style={{ ...theme.typography.body, marginTop: theme.spacing.md, color: theme.colors.textSecondary }}>
        {message}
      </Text>
    </View>
  );
}
