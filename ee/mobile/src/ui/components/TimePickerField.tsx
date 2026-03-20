import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const ITEM_HEIGHT = 44;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseHHMM(value: string): { hours: number; minutes: number } | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { hours: h, minutes: min };
}

function ScrollColumn({
  data,
  selected,
  onSelect,
  formatItem,
  colors,
  typography,
}: {
  data: number[];
  selected: number;
  onSelect: (val: number) => void;
  formatItem: (val: number) => string;
  colors: ReturnType<typeof useTheme>["colors"];
  typography: ReturnType<typeof useTheme>["typography"];
}) {
  const listRef = useRef<FlatList<number>>(null);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    if (!didInitialScroll.current) {
      didInitialScroll.current = true;
      const idx = data.indexOf(selected);
      if (idx >= 0) {
        // Delay to ensure layout is complete
        setTimeout(() => {
          listRef.current?.scrollToOffset({ offset: idx * ITEM_HEIGHT, animated: false });
        }, 50);
      }
    }
  }, [data, selected]);

  const renderItem = useCallback(
    ({ item }: { item: number }) => {
      const isSelected = item === selected;
      return (
        <Pressable
          onPress={() => onSelect(item)}
          accessibilityRole="button"
          accessibilityLabel={formatItem(item)}
          style={({ pressed }) => ({
            height: ITEM_HEIGHT,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: isSelected ? colors.primary : "transparent",
            borderRadius: 8,
            marginHorizontal: 4,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text
            style={{
              ...typography.body,
              fontSize: 18,
              color: isSelected ? colors.textInverse : colors.text,
              fontWeight: isSelected ? "700" : "400",
            }}
          >
            {formatItem(item)}
          </Text>
        </Pressable>
      );
    },
    [selected, colors, typography, onSelect, formatItem],
  );

  const keyExtractor = useCallback((item: number) => String(item), []);

  return (
    <FlatList
      ref={listRef}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      showsVerticalScrollIndicator={false}
      getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
      style={{ height: ITEM_HEIGHT * 5 }}
    />
  );
}

export function TimePickerField({
  value,
  onChange,
  placeholder = "Select time",
  label,
  disabled,
}: {
  /** Time string in "HH:MM" 24-hour format */
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
}) {
  const { colors, spacing, typography, borderRadius } = useTheme();
  const [open, setOpen] = useState(false);

  const parsed = value ? parseHHMM(value) : null;
  const [selectedHour, setSelectedHour] = useState(parsed?.hours ?? new Date().getHours());
  const [selectedMinute, setSelectedMinute] = useState(parsed?.minutes ?? 0);

  // Sync internal state when value changes externally
  useEffect(() => {
    const p = value ? parseHHMM(value) : null;
    if (p) {
      setSelectedHour(p.hours);
      setSelectedMinute(p.minutes);
    }
  }, [value]);

  const displayText = parsed
    ? formatDisplay(parsed.hours, parsed.minutes)
    : placeholder;

  const handleDone = () => {
    onChange(`${pad2(selectedHour)}:${pad2(selectedMinute)}`);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => {
          if (!disabled) {
            // Re-sync on open
            const p = value ? parseHHMM(value) : null;
            if (p) {
              setSelectedHour(p.hours);
              setSelectedMinute(p.minutes);
            }
            setOpen(true);
          }
        }}
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
            color: parsed ? colors.text : colors.placeholder,
          }}
        >
          {displayText}
        </Text>
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>{"🕐"}</Text>
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

            {/* Preview */}
            <Text style={{ ...typography.title, color: colors.text, textAlign: "center", marginBottom: spacing.lg }}>
              {formatDisplay(selectedHour, selectedMinute)}
            </Text>

            {/* Hour : Minute columns */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.caption, color: colors.textSecondary, textAlign: "center", marginBottom: spacing.xs }}>
                  Hour
                </Text>
                <ScrollColumn
                  data={HOURS}
                  selected={selectedHour}
                  onSelect={setSelectedHour}
                  formatItem={pad2}
                  colors={colors}
                  typography={typography}
                />
              </View>

              <Text style={{ ...typography.title, color: colors.textSecondary, marginHorizontal: spacing.sm }}>:</Text>

              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.caption, color: colors.textSecondary, textAlign: "center", marginBottom: spacing.xs }}>
                  Min
                </Text>
                <ScrollColumn
                  data={MINUTES}
                  selected={selectedMinute}
                  onSelect={setSelectedMinute}
                  formatItem={pad2}
                  colors={colors}
                  typography={typography}
                />
              </View>
            </View>

            {/* Done button */}
            <Pressable
              onPress={handleDone}
              accessibilityRole="button"
              accessibilityLabel="Done"
              style={({ pressed }) => ({
                marginTop: spacing.lg,
                paddingVertical: spacing.md,
                alignItems: "center",
                borderRadius: 10,
                backgroundColor: colors.primary,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ ...typography.body, color: colors.textInverse, fontWeight: "600" }}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function formatDisplay(hours: number, minutes: number): string {
  const h12 = hours % 12 || 12;
  const ampm = hours < 12 ? "AM" : "PM";
  return `${h12}:${pad2(minutes)} ${ampm}`;
}
