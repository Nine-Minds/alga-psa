'use client';

import { useMemo } from 'react';
import { createShortcutAction } from './catalog';
import { useShortcutAction, useShortcutScope } from './provider';
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

// Submit shortcut for forms hosted in a Drawer. The drawer itself pushes the
// 'panel' scope while open (DrawerContext), so unlike useDialogSubmitShortcut
// this only registers the action — page-scope saves are suppressed in panels,
// and this is the panel-scope replacement.
export function usePanelSubmitShortcut(handler: ShortcutAction['handler'], options: PageShortcutOptions = {}): void {
  const action = useMemo<ShortcutAction>(
    () => createShortcutAction('panel.submit', handler, { enabled: options.enabled }),
    [handler, options.enabled],
  );
  useShortcutAction(action);
}

interface DialogSubmitShortcutOptions {
  enabled?: boolean;
  active?: boolean;
}

export function useDialogSubmitShortcut(
  handler: ShortcutAction['handler'],
  options: DialogSubmitShortcutOptions = {},
): void {
  const active = options.active ?? true;
  useShortcutScope('dialog', active);
  const action = useMemo<ShortcutAction>(
    () => createShortcutAction('dialog.submit', handler, { enabled: options.enabled }),
    [handler, options.enabled],
  );
  useShortcutAction(action);
}
