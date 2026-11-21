import { View } from "react-native";
import { useTheme } from "../../../ui/ThemeContext";

/** A thin done/total bar; `ratio` is clamped to 0..1. */
export function ProgressBar({ ratio, testID }: { ratio: number; testID?: string }) {
  const theme = useTheme();
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: "100%",
          backgroundColor: theme.colors.primary,
        }}
      />
    </View>
  );
}
