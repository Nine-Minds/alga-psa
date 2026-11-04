'use client';

import { createContext, useContext } from 'react';

/**
 * Lets content hosted in the focus view switch to a sibling view (e.g. the
 * Software empty state opening Assets) without the tab registry having to
 * thread callbacks into every tab's content.
 */
export interface FocusViewNavigation {
  hasView: (tabId: string) => boolean;
  openView: (tabId: string) => void;
}

export const FocusViewNavigationContext = createContext<FocusViewNavigation | null>(null);

/** Null outside a FocusViewHost (e.g. a tab rendered standalone). */
export const useFocusViewNavigation = (): FocusViewNavigation | null => useContext(FocusViewNavigationContext);
