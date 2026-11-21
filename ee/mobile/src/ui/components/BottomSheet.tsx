import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";
import { DIALOG_MAX_WIDTH, useWindowLayout } from "../layout";
import { IconButton } from "./IconButton";
import { Feather } from "@expo/vector-icons";

const SNAP_FRACTIONS = {
  quarter: 0.25,
  half: 0.5,
  full: 0.92,
} as const;

export function BottomSheet({
  visible,
  onClose,
  title,
  snapPoint = "half",
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  snapPoint?: "quarter" | "half" | "full";
  children: ReactNode;
}) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight, isWide } = useWindowLayout();
  const sheetHeight = windowHeight * SNAP_FRACTIONS[snapPoint];
  // On wide windows a full-width sheet turns into a centred dialog.
  const sheetWidth = isWide ? Math.min(DIALOG_MAX_WIDTH, windowWidth - theme.spacing.xl * 2) : undefined;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: isWide ? "center" : "flex-end", alignItems: isWide ? "center" : undefined }}>
        {/* Overlay */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close bottom sheet"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
          }}
        />

        {/* Sheet */}
        <View
          style={{
            height: sheetHeight,
            width: sheetWidth,
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.borderRadius.xl,
            borderTopRightRadius: theme.borderRadius.xl,
            borderBottomLeftRadius: isWide ? theme.borderRadius.xl : 0,
            borderBottomRightRadius: isWide ? theme.borderRadius.xl : 0,
          }}
        >
          {/* Drag handle (a dialog has nothing to drag) */}
          <View style={{ alignItems: "center", paddingTop: theme.spacing.sm, display: isWide ? "none" : "flex" }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colors.border,
              }}
            />
          </View>

          {/* Header */}
          {title ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.borderLight,
              }}
            >
              <Text style={{ ...theme.typography.subtitle, color: theme.colors.text, flex: 1 }}>
                {title}
              </Text>
              <IconButton
                icon={<Feather name="x" size={20} color={theme.colors.textSecondary} />}
                onPress={onClose}
                accessibilityLabel="Close"
              />
            </View>
          ) : null}

          {/* Content */}
          <ScrollView
            contentContainerStyle={{ padding: theme.spacing.lg }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
