'use client';

import React, { useEffect, useCallback, useRef } from 'react';
import { KeyEvent, KeyModifiers, KeyLocation } from '@/types/remoteDesktop';
import { shouldPreventDefault } from '@/lib/remote-desktop/keymap';

interface KeyboardHandlerProps {
  /**
   * Callback when a key event should be sent to the remote machine
   */
  onKeyEvent: (event: KeyEvent) => void;

  /**
   * Whether keyboard handling is enabled
   */
  enabled: boolean;

  /**
   * The target element to attach keyboard listeners to
   * If not provided, uses document
   */
  targetRef?: React.RefObject<HTMLElement>;

  /**
   * Callback when keyboard focus state changes
   */
  onFocusChange?: (focused: boolean) => void;
}

/**
 * KeyboardHandler - Enhanced keyboard capture for remote desktop sessions
 *
 * This component handles:
 * - All keyboard events including special keys and modifiers
 * - Prevention of browser keyboard shortcuts during remote session
 * - Proper key code mapping with location information
 * - Modifier key state tracking
 */
export const KeyboardHandler: React.FC<KeyboardHandlerProps> = ({
  onKeyEvent,
  enabled,
  targetRef,
  onFocusChange,
}) => {
  // Track current modifier state to detect stuck keys
  const modifierStateRef = useRef<KeyModifiers>({
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  });

  // Track if we have focus for keyboard capture
  const hasFocusRef = useRef(false);

  /**
   * Convert browser KeyboardEvent to our KeyEvent format
   */
  const createKeyEvent = useCallback((
    e: KeyboardEvent,
    type: 'KeyDown' | 'KeyUp'
  ): KeyEvent => {
    const modifiers: KeyModifiers = {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    };

    // KeyboardEvent.location: 0=standard, 1=left, 2=right, 3=numpad
    const location = e.location as KeyLocation;

    return {
      type,
      key: e.key,
      code: e.code,
      modifiers,
      location,
    };
  }, []);

  /**
   * Update our tracked modifier state
   */
  const updateModifierState = useCallback((e: KeyboardEvent) => {
    modifierStateRef.current = {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    };
  }, []);

  /**
   * Handle keydown events
   */
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled || !hasFocusRef.current) return;

    // Determine if we should prevent the browser from handling this key
    const modifiers = {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    };

    if (shouldPreventDefault(e.code, modifiers)) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Update modifier state
    updateModifierState(e);

    // Create and send the key event
    const keyEvent = createKeyEvent(e, 'KeyDown');
    onKeyEvent(keyEvent);
  }, [enabled, createKeyEvent, updateModifierState, onKeyEvent]);

  /**
   * Handle keyup events
   */
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (!enabled || !hasFocusRef.current) return;

    // Prevent default for the same keys as keydown
    const modifiers = {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    };

    if (shouldPreventDefault(e.code, modifiers)) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Update modifier state
    updateModifierState(e);

    // Create and send the key event
    const keyEvent = createKeyEvent(e, 'KeyUp');
    onKeyEvent(keyEvent);
  }, [enabled, createKeyEvent, updateModifierState, onKeyEvent]);

  /**
   * Handle focus events
   */
  const handleFocus = useCallback(() => {
    hasFocusRef.current = true;
    onFocusChange?.(true);
  }, [onFocusChange]);

  const handleBlur = useCallback(() => {
    hasFocusRef.current = false;
    onFocusChange?.(false);

    // Release any stuck modifiers when we lose focus
    const currentModifiers = modifierStateRef.current;

    if (currentModifiers.ctrl) {
      onKeyEvent({
        type: 'KeyUp',
        key: 'Control',
        code: 'ControlLeft',
        modifiers: { ...currentModifiers, ctrl: false },
        location: 1,
      });
    }
    if (currentModifiers.alt) {
      onKeyEvent({
        type: 'KeyUp',
        key: 'Alt',
        code: 'AltLeft',
        modifiers: { ...currentModifiers, alt: false },
        location: 1,
      });
    }
    if (currentModifiers.shift) {
      onKeyEvent({
        type: 'KeyUp',
        key: 'Shift',
        code: 'ShiftLeft',
        modifiers: { ...currentModifiers, shift: false },
        location: 1,
      });
    }
    if (currentModifiers.meta) {
      onKeyEvent({
        type: 'KeyUp',
        key: 'Meta',
        code: 'MetaLeft',
        modifiers: { ...currentModifiers, meta: false },
        location: 1,
      });
    }

    // Reset our tracked state
    modifierStateRef.current = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
  }, [onFocusChange, onKeyEvent]);

  /**
   * Handle visibility change (tab switch, minimize)
   */
  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      // Release all modifiers when page becomes hidden
      handleBlur();
    }
  }, [handleBlur]);

  /**
   * Setup keyboard event listeners
   */
  useEffect(() => {
    const target = targetRef?.current ?? document;

    // Add event listeners with capture phase for better interception
    target.addEventListener('keydown', handleKeyDown as EventListener, { capture: true });
    target.addEventListener('keyup', handleKeyUp as EventListener, { capture: true });

    // Focus events (only on specific elements)
    if (targetRef?.current) {
      targetRef.current.addEventListener('focus', handleFocus);
      targetRef.current.addEventListener('blur', handleBlur);
    }

    // Visibility change for releasing modifiers
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      target.removeEventListener('keydown', handleKeyDown as EventListener, { capture: true });
      target.removeEventListener('keyup', handleKeyUp as EventListener, { capture: true });

      if (targetRef?.current) {
        targetRef.current.removeEventListener('focus', handleFocus);
        targetRef.current.removeEventListener('blur', handleBlur);
      }

      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [targetRef, handleKeyDown, handleKeyUp, handleFocus, handleBlur, handleVisibilityChange]);

  /**
   * Prevent context menu on right-click in remote session
   */
  useEffect(() => {
    if (!enabled) return;

    const handleContextMenu = (e: MouseEvent) => {
      if (hasFocusRef.current) {
        e.preventDefault();
      }
    };

    const target = targetRef?.current ?? document;
    target.addEventListener('contextmenu', handleContextMenu as EventListener);

    return () => {
      target.removeEventListener('contextmenu', handleContextMenu as EventListener);
    };
  }, [enabled, targetRef]);

  // This component doesn't render anything
  return null;
};

/**
 * Hook for using keyboard handling in components
 */
export function useKeyboardHandler(
  onKeyEvent: (event: KeyEvent) => void,
  enabled: boolean = true
) {
  const targetRef = useRef<HTMLElement>(null);

  const keyboardProps = {
    onKeyEvent,
    enabled,
    targetRef,
  };

  return {
    targetRef,
    keyboardProps,
  };
}

export default KeyboardHandler;
