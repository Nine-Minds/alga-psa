import { ActivityIndicator, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";

export function LoadingState({ message = "Loading…" }: { message?: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
        backgroundColor: colors.background,
      }}
    >
      <ActivityIndicator />
      <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.mutedText }}>
        {message}
      </Text>
    </View>
  );
}

