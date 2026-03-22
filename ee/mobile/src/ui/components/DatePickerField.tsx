import React, { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";
import { CalendarPicker } from "./CalendarPicker";

export function DatePickerField({
  value,
  onChange,
  placeholder = "Select date",
  label,
  disabled,
  clearable,
  minDate,
  maxDate,
}: {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  clearable?: boolean;
  minDate?: Date;
  maxDate?: Date;
}) {
  const { colors, spacing, typography, borderRadius } = useTheme();
  const [open, setOpen] = useState(false);

  const displayText = value
    ? value.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : placeholder;

  return (
    <>
      <Pressable
        onPress={() => { if (!disabled) setOpen(true); }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          opacity: disabled ? 0.5 : pressed ? 0.9 : 1,
        })}
      >
        <Text
          style={{
            ...typography.body,
            color: value ? colors.text : colors.placeholder,
            flex: 1,
          }}
        >
          {displayText}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {clearable && value ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
              accessibilityLabel="Clear date"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={{ ...typography.body, color: colors.textSecondary }}>{"×"}</Text>
            </Pressable>
          ) : null}
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>{"📅"}</Text>
        </View>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
          onPress={() => setOpen(false)}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: borderRadius.xl,
              borderTopRightRadius: borderRadius.xl,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: spacing.xxxl,
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: "center", marginBottom: spacing.md }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            <CalendarPicker
              selected={value}
              onSelect={(date) => {
                onChange(date);
                setOpen(false);
              }}
              minDate={minDate}
              maxDate={maxDate}
            />

            <View style={{ flexDirection: "row", marginTop: spacing.lg, gap: spacing.sm }}>
              {clearable ? (
                <Pressable
                  onPress={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear"
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: spacing.md,
                    alignItems: "center",
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: pressed ? 0.9 : 1,
                  })}
                >
                  <Text style={{ ...typography.body, color: colors.textSecondary, fontWeight: "600" }}>Clear</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Done"
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: spacing.md,
                  alignItems: "center",
                  borderRadius: 10,
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text style={{ ...typography.body, color: colors.textInverse, fontWeight: "600" }}>Done</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
