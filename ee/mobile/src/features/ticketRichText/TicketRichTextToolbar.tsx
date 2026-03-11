import React from "react";
import { Pressable, Text, View } from "react-native";
import type {
  TicketMobileEditorCommand,
  TicketMobileEditorStatePayload,
} from "./types";
import { colors, spacing, typography } from "../../ui/theme";

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
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: spacing.sm }}>
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
              marginRight: index === TOOLBAR_BUTTONS.length - 1 ? 0 : spacing.sm,
              marginBottom: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? "#D9F2EE" : colors.card,
              opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ ...typography.caption, color: colors.text, fontWeight: "600" }}>
              {button.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
