"use client";

import React, { createContext, useContext } from "react";

type SplitLayoutsContextValue = {
  enabled: boolean;
};

const SplitLayoutsContext = createContext<SplitLayoutsContextValue | null>(null);

export function SplitLayoutsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <SplitLayoutsContext.Provider value={{ enabled }}>{children}</SplitLayoutsContext.Provider>;
}

export function useSplitLayouts() {
  const value = useContext(SplitLayoutsContext);
  return value ?? { enabled: false };
}

