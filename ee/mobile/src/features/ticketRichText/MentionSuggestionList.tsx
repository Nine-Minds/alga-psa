import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "../../ui/ThemeContext";
import { Avatar } from "../../ui/components/Avatar";

export type MentionSuggestionItem = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

export function MentionSuggestionList({
  loading,
  users,
  onSelect,
  baseUrl,
  authToken,
}: {
  loading: boolean;
  users: MentionSuggestionItem[];
  onSelect: (item: MentionSuggestionItem) => void;
  baseUrl?: string | null;
  authToken?: string;
}) {
  const { colors, spacing, typography } = useTheme();

  if (!loading && users.length === 0) {
    return null;
  }

  return (
    <View
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        zIndex: 10,
        maxHeight: 200,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        marginBottom: spacing.xs,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 4,
      }}
    >
      {loading && users.length === 0 ? (
        <View style={{ padding: spacing.md, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={{ maxHeight: 200 }}
        >
          {users.map((item) => (
            <Pressable
              key={item.user_id}
              onPress={() => onSelect(item)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${item.display_name}`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                backgroundColor: pressed ? colors.background : "transparent",
              })}
            >
              <Avatar
                name={item.display_name}
                imageUri={item.avatar_url && baseUrl ? `${baseUrl}${item.avatar_url}` : undefined}
                authToken={authToken}
                size="sm"
              />
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <Text style={{ ...typography.body, color: colors.text }} numberOfLines={1}>
                  {item.display_name}
                </Text>
                {item.username ? (
                  <Text style={{ ...typography.caption, color: colors.textSecondary }} numberOfLines={1}>
                    @{item.username}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
