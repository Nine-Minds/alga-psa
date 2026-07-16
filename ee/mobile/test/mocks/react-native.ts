import React, { forwardRef } from "react";

type MockComponentProps = Record<string, unknown> & {
  children?: React.ReactNode;
};

function createMockComponent(name: string) {
  return forwardRef<unknown, MockComponentProps>(function MockComponent(props, ref) {
    return React.createElement(name, { ...props, ref }, props.children as React.ReactNode);
  });
}

export const Platform = { OS: "web" };
export const StyleSheet = { create: <T extends Record<string, unknown>>(styles: T): T => styles };
export const View = createMockComponent("View");
export const Text = createMockComponent("Text");
export const ActivityIndicator = createMockComponent("ActivityIndicator");
export const Pressable = createMockComponent("Pressable");
export const TextInput = createMockComponent("TextInput");
export const ScrollView = createMockComponent("ScrollView");
export const Modal = createMockComponent("Modal");
export const KeyboardAvoidingView = createMockComponent("KeyboardAvoidingView");
export const RefreshControl = createMockComponent("RefreshControl");
export const Alert = {
  alert: () => undefined,
};
export const Vibration = {
  vibrate: () => undefined,
};
export function useWindowDimensions() {
  return { width: 390, height: 844, scale: 2, fontScale: 1 };
}

type MockFlatListProps<T> = Record<string, unknown> & {
  data?: T[];
  renderItem?: (info: { item: T; index: number }) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  ListEmptyComponent?: React.ReactNode | React.ComponentType;
};

export function FlatList<T>(props: MockFlatListProps<T>) {
  const { data = [], renderItem, keyExtractor, ListEmptyComponent, ...rest } = props;
  const children =
    data.length === 0
      ? ListEmptyComponent
        ? React.isValidElement(ListEmptyComponent)
          ? ListEmptyComponent
          : React.createElement(ListEmptyComponent as React.ComponentType)
        : null
      : data.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: keyExtractor ? keyExtractor(item, index) : String(index) },
            renderItem?.({ item, index }),
          ),
        );
  return React.createElement("FlatList", rest, children);
}
export const AppState = {
  currentState: "active" as string,
  addEventListener: () => ({
    remove: () => undefined,
  }),
};
export const Linking = {
  openURL: async (url: string) => {
    void url;
  },
};
