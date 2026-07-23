import React from "react";
import { Text } from "react-native";
import { useTheme } from "../../../ui/ThemeContext";

// Renders a work-queue "why" sentence, bolding the emphasis substring when the
// server provides one and it is found within the text.
export function WhySentence({
  text,
  emphasis,
  testID,
}: {
  text: string;
  emphasis?: string;
  testID?: string;
}) {
  const theme = useTheme();
  const base = { ...theme.typography.caption, color: theme.colors.textSecondary };

  const index = emphasis ? text.indexOf(emphasis) : -1;
  if (!emphasis || index < 0) {
    return (
      <Text testID={testID} style={base}>
        {text}
      </Text>
    );
  }

  const before = text.slice(0, index);
  const after = text.slice(index + emphasis.length);
  return (
    <Text testID={testID} style={base}>
      {before}
      <Text style={{ ...base, color: theme.colors.text, fontWeight: "700" }}>{emphasis}</Text>
      {after}
    </Text>
  );
}
