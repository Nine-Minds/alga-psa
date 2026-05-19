'use client';

import { useMemo } from 'react';
import { createShortcutAction } from './catalog';
import { useShortcutAction } from './provider';
import type { ShortcutAction } from './types';

interface PageShortcutOptions {
  enabled?: boolean;
}

function useCatalogPageShortcut(
  id: 'page.create' | 'page.save',
  handler: ShortcutAction['handler'],
  options: PageShortcutOptions = {},
): void {
  const action = useMemo<ShortcutAction>(() => {
    return createShortcutAction(id, handler, { enabled: options.enabled });
  }, [handler, id, options.enabled]);

  useShortcutAction(action);
}

export function usePageCreateShortcut(handler: ShortcutAction['handler'], options: PageShortcutOptions = {}): void {
  useCatalogPageShortcut('page.create', handler, options);
}

export function usePageSaveShortcut(handler: ShortcutAction['handler'], options: PageShortcutOptions = {}): void {
  useCatalogPageShortcut('page.save', handler, options);
}
