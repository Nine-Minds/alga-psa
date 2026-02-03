import { Pressable, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";

export function OfflineBanner({ onRetry }: { onRetry?: () => void }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      accessibilityRole="alert"
      accessibilityLabel="Offline"
    >
      <Text style={{ ...typography.body, color: colors.text }}>Offline</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button">
          <Text style={{ ...typography.body, color: colors.primary, fontWeight: "600" }}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

