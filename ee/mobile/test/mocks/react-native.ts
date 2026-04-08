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
export const Linking = {
  openURL: async (url: string) => {
    void url;
  },
};
