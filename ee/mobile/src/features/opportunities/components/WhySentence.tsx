import React from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import type { TranslatableText, WorkQueueWhy } from "../../../api/opportunities";
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

function mobileTranslationKey(key: string): string {
  return key.startsWith("opportunities.") ? key.slice("opportunities.".length) : key;
}

/** Render the server's translated segments without flattening away emphasis. */
export function StructuredWhySentence({ why, testID }: { why: WorkQueueWhy; testID?: string }) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const base = { ...theme.typography.caption, color: theme.colors.textSecondary };

  return (
    <Text testID={testID} style={base}>
      {why.segments.map((segment, index) => {
        const message = translateQueueText(t, segment.message);
        return segment.emphasis ? (
          <Text key={index} style={{ ...base, color: theme.colors.text, fontWeight: "700" }}>
            {message}
          </Text>
        ) : (
          <React.Fragment key={index}>{message}</React.Fragment>
        );
      })}
    </Text>
  );
}

export function translateQueueText(
  t: (key: string, options?: Record<string, unknown>) => string,
  message: TranslatableText,
): string {
  return t(mobileTranslationKey(message.key), message.params);
}
