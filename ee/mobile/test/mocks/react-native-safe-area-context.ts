// Minimal mock for react-native-safe-area-context in Node test environment.
import React from "react";

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function useSafeAreaInsets() {
  return insets;
}

export function SafeAreaProvider({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

export function SafeAreaView({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}
