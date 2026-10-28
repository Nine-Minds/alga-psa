'use client';

import React, { createContext, useContext } from 'react';
import { Button } from './Button';

/**
 * Where an action trigger is being rendered. The host that places an injected
 * feature's trigger decides its presentation; the feature only declares
 * id/icon/label/onClick. This keeps self-contained "trigger + dialog" features
 * placeable anywhere (a hero action bar, a tile footer) without each one
 * growing styling props.
 */
export type ActionSurfaceKind = 'bar' | 'tile';

const ActionSurfaceContext = createContext<ActionSurfaceKind>('bar');

export function ActionSurface({ kind, children }: { kind: ActionSurfaceKind; children: React.ReactNode }) {
  return <ActionSurfaceContext.Provider value={kind}>{children}</ActionSurfaceContext.Provider>;
}

export function useActionSurface(): ActionSurfaceKind {
  return useContext(ActionSurfaceContext);
}

export interface ActionTriggerProps {
  id: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

/** A feature's entry-point trigger, styled by the surrounding ActionSurface. */
export const ActionTrigger = React.forwardRef<HTMLButtonElement, ActionTriggerProps>(function ActionTrigger(
  { id, icon, label, onClick, disabled, title },
  ref,
) {
  const kind = useActionSurface();
  if (kind === 'tile') {
    return (
      <button
        ref={ref}
        id={id}
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline disabled:opacity-50 disabled:no-underline [&_svg]:h-3.5 [&_svg]:w-3.5"
      >
        {icon}
        {label}
      </button>
    );
  }
  return (
    <Button
      ref={ref}
      id={id}
      type="button"
      variant="soft"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5"
    >
      {icon}
      {label}
    </Button>
  );
});
