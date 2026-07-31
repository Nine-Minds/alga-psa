import { Fragment, memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { Theme } from "../../../ui/themes";
import type { Activity, ActivityGroup } from "../../../api/activities";
import { ActivityRow } from "./ActivityRow";
import { planGroupDrag, type DragSlot, type GroupDragPlan } from "../groupDragPlan";
import { computeDropLayout, headerRowKey, itemRowKey, nearestSlot } from "../groupDragLayout";

const LONG_PRESS_MS = 250;

/**
 * Drag-to-organize variant of the grouped activity list, used only for the "My groups"
 * (custom) view. Long-press a card to lift it, then drag it within a group, into another
 * group, or onto the Ungrouped bucket to remove it. Hit-testing derives one vertical axis by
 * summing measured row heights in render order (onLayout `y` is parent-relative and unreliable
 * across groups); the scroll is locked mid-drag so the gesture's screen delta shares that axis,
 * and `planGroupDrag` turns the drop into the single server call.
 *
 * Auto-scroll while dragging is intentionally omitted: the custom set is server-capped and
 * fits a short scroll, so a drop target that's off-screen is the rare case.
 */
export function DraggableGroupedList({
  theme,
  groups,
  collapsed,
  onToggleCollapsed,
  titleForGroup,
  onPressActivity,
  onCommit,
  refreshing,
  onRefresh,
  header,
  emptyComponent,
  dragHint,
}: {
  theme: Theme;
  groups: ActivityGroup[];
  collapsed: Set<string>;
  onToggleCollapsed: (key: string) => void;
  titleForGroup: (group: ActivityGroup) => string;
  onPressActivity: (activity: Activity) => void;
  onCommit: (plan: GroupDragPlan) => void;
  refreshing: boolean;
  onRefresh: () => void;
  header: ReactNode;
  emptyComponent: ReactNode;
  dragHint: string;
}) {
  // Row heights only — NOT onLayout `y`. A row's `y` is parent-relative and proved unreliable
  // for cross-group comparison; heights are intrinsic and reliable. Positions are derived by
  // summing heights in render order (see computeLayout).
  const heightsRef = useRef<Map<string, number>>(new Map());
  const fromRef = useRef<DragSlot | null>(null);
  const hoverRef = useRef<DragSlot | null>(null);

  // Shared values drive the lifted card on the UI thread; React state mirrors only what the
  // (non-animated) tree needs: which card is active (to lock scroll) and the drop indicator.
  const translateY = useSharedValue(0);
  const activeKeySV = useSharedValue<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [indicatorY, setIndicatorY] = useState<number | null>(null);

  const setHeight = useCallback((key: string, height: number) => {
    heightsRef.current.set(key, height);
  }, []);

  const onBegin = useCallback((rowKey: string, slot: DragSlot) => {
    fromRef.current = slot;
    hoverRef.current = slot;
    setActiveKey(rowKey);
  }, []);

  const onMove = useCallback(
    (rowKey: string, translation: number) => {
      const { tops, slots } = computeDropLayout(groups, collapsed, heightsRef.current);
      const active = tops.get(rowKey);
      if (!active) return;
      // The lifted card's center, on the derived axis, is the drop probe.
      const probe = active.top + active.height / 2 + translation;
      const best = nearestSlot(slots, probe);
      if (!best) return;
      const y = best.y;
      hoverRef.current = best.slot;
      setIndicatorY((prev) => (prev === y ? prev : y));
    },
    [groups, collapsed],
  );

  const onEnd = useCallback(() => {
    const from = fromRef.current;
    const to = hoverRef.current;
    fromRef.current = null;
    hoverRef.current = null;
    setActiveKey(null);
    setIndicatorY(null);
    if (!from || !to) return;
    const plan = planGroupDrag(groups, from, to);
    if (plan.mutation.kind !== "noop") onCommit(plan);
  }, [groups, onCommit]);

  const dragging = activeKey !== null;

  return (
    <ScrollView
      scrollEnabled={!dragging}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={{
        padding: theme.spacing.lg,
        paddingBottom: theme.spacing.xxxl,
        flexGrow: 1,
        backgroundColor: theme.colors.background,
      }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      <View>
        {header}

        {groups.length === 0 ? (
          emptyComponent
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing.sm }}>
              <Feather name="move" size={12} color={theme.colors.textSecondary} />
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginLeft: theme.spacing.xs }}>
                {dragHint}
              </Text>
            </View>

            {/* The list body is the axis origin: the first group header sits at its top (y=0),
                which is exactly where computeLayout's derived axis starts. So the indicator's
                derived `top` lands correctly here, and hit-testing relies only on row heights —
                never on each row's (parent-relative, unreliable) onLayout `y`. */}
            <View>
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.key);
                return (
                  <Fragment key={group.key}>
                    <GroupHeaderRow
                      theme={theme}
                      title={titleForGroup(group)}
                      count={group.count}
                      collapsed={isCollapsed}
                      onToggle={() => onToggleCollapsed(group.key)}
                      onLayout={(e) => setHeight(headerRowKey(group.key), e.nativeEvent.layout.height)}
                    />
                    {isCollapsed
                      ? null
                      : group.activities.map((activity, index) => {
                          const rowKey = itemRowKey(group.key, activity);
                          return (
                            <DraggableItem
                              key={rowKey}
                              theme={theme}
                              rowKey={rowKey}
                              groupKey={group.key}
                              index={index}
                              activity={activity}
                              translateY={translateY}
                              activeKeySV={activeKeySV}
                              onPressActivity={onPressActivity}
                              onBegin={onBegin}
                              onMove={onMove}
                              onEnd={onEnd}
                              onLayout={(e) => setHeight(rowKey, e.nativeEvent.layout.height)}
                            />
                          );
                        })}
                  </Fragment>
                );
              })}

              {indicatorY !== null ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: indicatorY - 1,
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: theme.colors.primary,
                  }}
                />
              ) : null}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const DraggableItem = memo(function DraggableItem({
  theme,
  rowKey,
  groupKey,
  index,
  activity,
  translateY,
  activeKeySV,
  onPressActivity,
  onBegin,
  onMove,
  onEnd,
  onLayout,
}: {
  theme: Theme;
  rowKey: string;
  groupKey: string;
  index: number;
  activity: Activity;
  translateY: SharedValue<number>;
  activeKeySV: SharedValue<string | null>;
  onPressActivity: (activity: Activity) => void;
  onBegin: (rowKey: string, slot: DragSlot) => void;
  onMove: (rowKey: string, translation: number) => void;
  onEnd: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LONG_PRESS_MS)
        .onStart(() => {
          "worklet";
          activeKeySV.value = rowKey;
          translateY.value = 0;
          runOnJS(onBegin)(rowKey, { groupKey, index });
        })
        .onUpdate((e) => {
          "worklet";
          if (activeKeySV.value !== rowKey) return;
          translateY.value = e.translationY;
          runOnJS(onMove)(rowKey, e.translationY);
        })
        .onEnd(() => {
          "worklet";
          runOnJS(onEnd)();
        })
        .onFinalize(() => {
          "worklet";
          if (activeKeySV.value === rowKey) {
            activeKeySV.value = null;
            translateY.value = 0;
          }
        }),
    [rowKey, groupKey, index, activeKeySV, translateY, onBegin, onMove, onEnd],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeKeySV.value === rowKey;
    return {
      transform: [
        { translateY: active ? translateY.value : 0 },
        { scale: withTiming(active ? 1.03 : 1, { duration: 120 }) },
      ],
      zIndex: active ? 999 : 0,
      elevation: active ? 8 : 0,
      opacity: active ? 0.97 : 1,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View onLayout={onLayout} style={animatedStyle}>
        <ActivityRow activity={activity} onPress={onPressActivity} />
        <View
          pointerEvents="none"
          style={{ position: "absolute", right: 6, top: 0, bottom: 0, justifyContent: "center" }}
        >
          <Feather name="menu" size={16} color={theme.colors.placeholder} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const GroupHeaderRow = memo(function GroupHeaderRow({
  theme,
  title,
  count,
  collapsed,
  onToggle,
  onLayout,
}: {
  theme: Theme;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Pressable
      onLayout={onLayout}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.sm,
        backgroundColor: theme.colors.background,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Feather name={collapsed ? "chevron-right" : "chevron-down"} size={16} color={theme.colors.textSecondary} />
      <Text style={{ ...theme.typography.body, color: theme.colors.text, fontWeight: "700", marginLeft: theme.spacing.xs, flex: 1 }}>
        {title}
      </Text>
      <View
        style={{
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 2,
          borderRadius: theme.borderRadius.full,
          backgroundColor: theme.colors.badge.neutral.bg,
          borderWidth: 1,
          borderColor: theme.colors.badge.neutral.border,
        }}
      >
        <Text style={{ ...theme.typography.caption, color: theme.colors.badge.neutral.text, fontWeight: "700" }}>{count}</Text>
      </View>
    </Pressable>
  );
});
