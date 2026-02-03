import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
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
      <Text style={{ ...typography.title, textAlign: "center", color: colors.danger }}>{title}</Text>
      {description ? (
        <Text style={{ ...typography.body, marginTop: spacing.md, textAlign: "center", color: colors.mutedText }}>
          {description}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

