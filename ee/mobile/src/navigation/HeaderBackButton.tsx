import React from "react";
import { Pressable, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../ui/ThemeContext";

export type BackNavigation = {
  canGoBack: () => boolean;
  goBack: () => void;
  navigate: (screen: "Tabs") => void;
};

export function goBackOrTabs(navigation: BackNavigation) {
  return () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Tabs");
  };
}

export function HeaderBackButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        marginRight: 8,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="chevron-left" size={24} color={theme.colors.primary} />
      <Text style={{ color: theme.colors.primary, fontSize: 16, marginLeft: 2 }}>{label}</Text>
    </Pressable>
  );
}

export function headerBackOptions(label: string, onPress: () => void) {
  return {
    headerBackVisible: false,
    headerLeft: () => <HeaderBackButton label={label} onPress={onPress} />,
  };
}
