import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
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
      <Text style={{ ...theme.typography.title, textAlign: "center", color: theme.colors.text }}>{title}</Text>
      {description ? (
        <Text style={{ ...theme.typography.body, marginTop: theme.spacing.md, textAlign: "center", color: theme.colors.textSecondary }}>
          {description}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: theme.spacing.lg }}>{action}</View> : null}
    </View>
  );
}
