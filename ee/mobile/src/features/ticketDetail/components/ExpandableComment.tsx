import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../ui/ThemeContext";
import { TicketRichTextEditor } from "../../ticketRichText/TicketRichTextEditor";

const COMMENT_COLLAPSED_HEIGHT = 96;

export function ExpandableComment({
  content,
  loadingLabel,
  onLinkPress,
  imageAuth,
  colors,
  typography,
  spacing,
  t,
}: {
  content: string;
  loadingLabel: string;
  onLinkPress?: (url: string) => void;
  imageAuth?: { baseUrl: string; apiKey: string };
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const needsExpansion = contentHeight !== null && contentHeight > COMMENT_COLLAPSED_HEIGHT;

  return (
    <View style={{ marginTop: spacing.xs }}>
      <TicketRichTextEditor
        content={content}
        editable={false}
        height={expanded || !needsExpansion ? (contentHeight ?? COMMENT_COLLAPSED_HEIGHT) : COMMENT_COLLAPSED_HEIGHT}
        scrollEnabled={false}
        loadingLabel={loadingLabel}
        onLinkPress={onLinkPress}
        imageAuth={imageAuth}
        onContentHeight={({ height }) => setContentHeight(height)}
      />
      {needsExpansion ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? t("comments.seeLess") : t("comments.seeMore")}
          style={{ paddingTop: spacing.xs }}
        >
          <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
            {expanded ? t("comments.seeLess") : t("comments.seeMore")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
