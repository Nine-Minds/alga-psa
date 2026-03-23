import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function CalendarPicker({
  selected,
  onSelect,
  minDate,
  maxDate,
}: {
  selected?: Date;
  onSelect: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
}) {
  const { colors, spacing, typography } = useTheme();
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());

  const cells = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const isDisabled = (day: number): boolean => {
    const d = new Date(viewYear, viewMonth, day);
    if (minDate && d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) return true;
    if (maxDate && d > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())) return true;
    return false;
  };

  const cellSize = 40;

  return (
    <View>
      {/* Month/Year header with navigation */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
        <Pressable
          onPress={goToPrevMonth}
          accessibilityLabel="Previous month"
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({
            padding: spacing.sm,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ ...typography.subtitle, color: colors.primary }}>{"<"}</Text>
        </Pressable>

        <Pressable onPress={goToToday} accessibilityLabel="Go to today" accessibilityRole="button">
          <Text style={{ ...typography.subtitle, color: colors.text }}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </Text>
        </Pressable>

        <Pressable
          onPress={goToNextMonth}
          accessibilityLabel="Next month"
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({
            padding: spacing.sm,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ ...typography.subtitle, color: colors.primary }}>{">"}</Text>
        </Pressable>
      </View>

      {/* Day name headers */}
      <View style={{ flexDirection: "row" }}>
        {DAY_NAMES.map((name) => (
          <View key={name} style={{ width: cellSize, alignItems: "center", paddingVertical: spacing.xs }}>
            <Text style={{ ...typography.caption, color: colors.textSecondary, fontWeight: "600" }}>{name}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((day, idx) => {
          if (day === null) {
            return <View key={`empty-${idx}`} style={{ width: cellSize, height: cellSize }} />;
          }

          const date = new Date(viewYear, viewMonth, day);
          const isToday = isSameDay(date, today);
          const isSelected = selected ? isSameDay(date, selected) : false;
          const disabled = isDisabled(day);

          return (
            <Pressable
              key={`day-${day}`}
              onPress={() => {
                if (!disabled) onSelect(date);
              }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${MONTH_NAMES[viewMonth]} ${day}, ${viewYear}`}
              style={({ pressed }) => ({
                width: cellSize,
                height: cellSize,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: cellSize / 2,
                backgroundColor: isSelected ? colors.primary : "transparent",
                opacity: disabled ? 0.3 : pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  ...typography.body,
                  color: isSelected ? colors.textInverse : isToday ? colors.primary : colors.text,
                  fontWeight: isToday || isSelected ? "700" : "400",
                }}
              >
                {day}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
