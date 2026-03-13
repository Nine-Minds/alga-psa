import React from "react";
import { Pressable, Text, View } from "react-native";
import type {
  TicketMobileEditorCommand,
  TicketMobileEditorStatePayload,
} from "./types";
import { useTheme } from "../../ui/ThemeContext";

type ToolbarButton = {
  label: string;
  command: TicketMobileEditorCommand;
  active?: keyof TicketMobileEditorStatePayload["toolbar"];
  history?: "undo" | "redo";
};

const TOOLBAR_BUTTONS: ToolbarButton[] = [
  { label: "Bold", command: "toggle-bold", active: "bold" },
  { label: "Italic", command: "toggle-italic", active: "italic" },
  { label: "Underline", command: "toggle-underline", active: "underline" },
  { label: "Bullets", command: "toggle-bullet-list", active: "bulletList" },
  { label: "Numbers", command: "toggle-ordered-list", active: "orderedList" },
  { label: "Undo", command: "undo", history: "undo" },
  { label: "Redo", command: "redo", history: "redo" },
];

export function TicketRichTextToolbar({
  ready,
  editable,
  state,
  onCommand,
}: {
  ready: boolean;
  editable: boolean;
  state: TicketMobileEditorStatePayload;
  onCommand: (command: TicketMobileEditorCommand) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: theme.spacing.sm }}>
      {TOOLBAR_BUTTONS.map((button, index) => {
        const isHistoryDisabled = button.history === "undo"
          ? !state.canUndo
          : button.history === "redo"
            ? !state.canRedo
            : false;
        const disabled = !ready || !editable || isHistoryDisabled;
        const active = button.active ? state.toolbar[button.active] : false;

        return (
          <Pressable
            key={button.command}
            accessibilityRole="button"
            accessibilityLabel={`Editor command ${button.label}`}
            disabled={disabled}
            onPress={() => onCommand(button.command)}
            style={({ pressed }) => ({
              marginRight: index === TOOLBAR_BUTTONS.length - 1 ? 0 : theme.spacing.sm,
              marginBottom: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: 6,
              borderRadius: theme.borderRadius.full,
              borderWidth: 1,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: active ? theme.colors.primaryLight : theme.colors.card,
              opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ ...theme.typography.caption, color: theme.colors.text, fontWeight: "600" }}>
              {button.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
