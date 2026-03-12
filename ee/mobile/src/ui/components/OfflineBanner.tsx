import { Pressable, Text, View } from "react-native";
import { hitSlop } from "../a11y";
import { useTheme } from "../ThemeContext";

export function OfflineBanner({ onRetry }: { onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      accessibilityRole="alert"
      accessibilityLabel="Offline"
    >
      <Text style={{ ...theme.typography.body, color: theme.colors.text }}>Offline</Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          hitSlop={hitSlop}
        >
          <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "600" }}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
