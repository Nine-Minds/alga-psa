import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../ui/ThemeContext";
import { TicketRichTextEditor } from "../../ticketRichText/TicketRichTextEditor";

export const COMMENT_COLLAPSED_HEIGHT = 96;

export function ExpandableComment({
  content,
  loadingLabel,
  onLinkPress,
  imageAuth,
  colors,
  typography,
  spacing,
  t,
  renderFooter,
}: {
  content: string;
  loadingLabel: string;
  onLinkPress?: (url: string) => void;
  imageAuth?: { baseUrl: string; apiKey: string };
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
  spacing: ReturnType<typeof useTheme>["spacing"];
  t: (key: string) => string;
  /** Called with expansion controls so the parent can render "see more" inline with other elements. */
  renderFooter?: (opts: { needsExpansion: boolean; expanded: boolean; toggle: () => void }) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const needsExpansion = contentHeight !== null && contentHeight > COMMENT_COLLAPSED_HEIGHT;

  const toggle = () => setExpanded((v) => !v);

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
        onContentHeight={({ height }) => setContentHeight(Math.ceil(height))}
      />
      {renderFooter ? (
        renderFooter({ needsExpansion, expanded, toggle })
      ) : needsExpansion ? (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={expanded ? t("comments.seeLess") : t("comments.seeMore")}
          style={{ paddingTop: spacing.xs, alignSelf: "flex-end" }}
        >
          <Text style={{ ...typography.caption, color: colors.primary, fontWeight: "600" }}>
            {expanded ? t("comments.seeLess") : t("comments.seeMore")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
