import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ThemeContext";
import { getTagChipColors } from "../tagColors";

/** A chip tag as the API sends it: `tag_id` is the tag definition id. */
export type DisplayTag = {
  tag_id: string;
  tag_text: string;
  background_color?: string | null;
  text_color?: string | null;
};

/** Longest chip label before it is truncated; matches the ticket-row tag chips. */
const MAX_TEXT_WIDTH = 160;

/**
 * The badge run next to a client or contact: the tags the server picked by the
 * tenant's tag display rules, in rule order. Shows the first `maxBadges` and
 * folds the rest into a "+n" pill. It never decides which tags are visible, so
 * an empty list renders nothing.
 */
export function DisplayTagBadges({
  tags,
  maxBadges = 2,
  style,
}: {
  tags?: readonly DisplayTag[] | null;
  maxBadges?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation("common");
  const theme = useTheme();
  const list = tags ?? [];
  if (list.length === 0) return null;

  const cap = Math.max(0, maxBadges);
  const shown = list.slice(0, cap);
  const hidden = list.slice(cap);
  const pill = {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  } as const;

  return (
    <View
      testID="display-tag-badges"
      style={[{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing.xs }, style]}
    >
      {shown.map((tag) => {
        const chip = getTagChipColors(tag, theme.mode);
        return (
          <View
            key={tag.tag_id}
            accessibilityRole="text"
            accessibilityLabel={t("entityTags.tag", { tag: tag.tag_text, defaultValue: "Tag {{tag}}" })}
            style={{
              ...pill,
              borderColor: theme.highContrast ? chip.textColor : chip.borderColor,
              backgroundColor: chip.backgroundColor,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ ...theme.typography.caption, color: chip.textColor, fontWeight: "600", maxWidth: MAX_TEXT_WIDTH }}
            >
              {tag.tag_text}
            </Text>
          </View>
        );
      })}
      {hidden.length > 0 ? (
        <View
          accessibilityRole="text"
          accessibilityLabel={t("entityTags.more", {
            count: hidden.length,
            names: hidden.map((tag) => tag.tag_text).join(", "),
            defaultValue: "{{count}} more tags: {{names}}",
          })}
          style={{
            ...pill,
            borderColor: theme.highContrast ? theme.colors.text : theme.colors.badge.neutral.border,
            backgroundColor: theme.colors.badge.neutral.bg,
          }}
        >
          <Text style={{ ...theme.typography.caption, color: theme.colors.badge.neutral.text, fontWeight: "600" }}>
            +{hidden.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
