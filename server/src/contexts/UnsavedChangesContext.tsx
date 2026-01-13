'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog';

interface UnsavedChangesContextType {
  /**
   * Register that a component has unsaved changes
   * @param componentId Unique identifier for the component
   * @param hasChanges Whether the component has unsaved changes
   */
  setHasUnsavedChanges: (componentId: string, hasChanges: boolean) => void;

  /**
   * Check if any registered component has unsaved changes
   */
  hasAnyUnsavedChanges: () => boolean;

  /**
   * Try to perform a navigation action, showing confirmation if there are unsaved changes
   * @param action The action to perform if confirmed
   * @returns true if action was performed immediately, false if dialog was shown
   */
  confirmNavigation: (action: () => void) => boolean;

  /**
   * Unregister a component (call on unmount)
   * @param componentId The component to unregister
   */
  unregister: (componentId: string) => void;
}

export const UnsavedChangesContext = createContext<UnsavedChangesContextType | null>(null);

interface UnsavedChangesProviderProps {
  children: React.ReactNode;
  /**
   * Custom title for the confirmation dialog
   */
  dialogTitle?: string;
  /**
   * Custom message for the confirmation dialog
   */
  dialogMessage?: string;
}

export function UnsavedChangesProvider({
  children,
  dialogTitle = 'Unsaved Changes',
  dialogMessage = 'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.',
}: UnsavedChangesProviderProps) {
  // Use ref to track unsaved components without causing re-renders
  const unsavedComponentsRef = useRef<Set<string>>(new Set());

  // Dialog state - this is the only state that needs to cause re-renders
  const [showDialog, setShowDialog] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const setHasUnsavedChanges = useCallback((componentId: string, hasChanges: boolean) => {
    if (hasChanges) {
      unsavedComponentsRef.current.add(componentId);
    } else {
      unsavedComponentsRef.current.delete(componentId);
    }
  }, []);

  const hasAnyUnsavedChanges = useCallback(() => {
    return unsavedComponentsRef.current.size > 0;
  }, []);

  const unregister = useCallback((componentId: string) => {
    unsavedComponentsRef.current.delete(componentId);
  }, []);

  const confirmNavigation = useCallback((action: () => void): boolean => {
    if (unsavedComponentsRef.current.size === 0) {
      // No unsaved changes, perform action immediately
      action();
      return true;
    }

    // Store the pending action and show dialog
    pendingActionRef.current = action;
    setShowDialog(true);
    return false;
  }, []);

  const handleConfirm = useCallback(() => {
    // Clear all unsaved changes since user chose to discard
    unsavedComponentsRef.current.clear();
    setShowDialog(false);

    // Execute the pending action
    if (pendingActionRef.current) {
      pendingActionRef.current();
      pendingActionRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    setShowDialog(false);
    pendingActionRef.current = null;
    pendingNavigationRef.current = null;
  }, []);

  // Router for programmatic navigation after confirmation
  const router = useRouter();
  const pendingNavigationRef = useRef<string | null>(null);

  // Handle browser beforeunload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsavedComponentsRef.current.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Intercept link clicks for client-side navigation (Next.js App Router)
  useEffect(() => {
    const handleLinkClick = (e: MouseEvent) => {
      // Only proceed if there are unsaved changes
      if (unsavedComponentsRef.current.size === 0) return;

      // Find the closest anchor element
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Skip external links, hash links, and non-navigation links
      if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      // Skip links with target="_blank"
      if (anchor.target === '_blank') return;

      // Skip links with download attribute
      if (anchor.hasAttribute('download')) return;

      // Prevent the navigation
      e.preventDefault();
      e.stopPropagation();

      // Store the pending navigation URL
      pendingNavigationRef.current = href;

      // Set up the pending action to navigate after confirmation
      pendingActionRef.current = () => {
        if (pendingNavigationRef.current) {
          router.push(pendingNavigationRef.current);
          pendingNavigationRef.current = null;
        }
      };

      // Show the confirmation dialog
      setShowDialog(true);
    };

    // Use capture phase to intercept before Next.js Link handles it
    document.addEventListener('click', handleLinkClick, true);
    return () => document.removeEventListener('click', handleLinkClick, true);
  }, [router]);

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    setHasUnsavedChanges,
    hasAnyUnsavedChanges,
    confirmNavigation,
    unregister,
  }), [setHasUnsavedChanges, hasAnyUnsavedChanges, confirmNavigation, unregister]);

  return (
    <UnsavedChangesContext value={contextValue}>
      {children}
      <ConfirmationDialog
        id="unsaved-changes-dialog"
        isOpen={showDialog}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={dialogTitle}
        message={dialogMessage}
        confirmLabel="Leave Without Saving"
        cancelLabel="Stay"
      />
    </UnsavedChangesContext>
  );
}

/**
 * Hook to access the unsaved changes context
 */
export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  }
  return context;
}

/**
 * Hook to register a component's unsaved changes state
 * Automatically unregisters on unmount
 */
export function useRegisterUnsavedChanges(componentId: string, hasChanges: boolean) {
  const context = useContext(UnsavedChangesContext);

  // Use ref to store the context to avoid dependency issues
  const contextRef = useRef(context);
  contextRef.current = context;

  // Register/update on hasChanges change
  useEffect(() => {
    if (contextRef.current) {
      contextRef.current.setHasUnsavedChanges(componentId, hasChanges);
    }
  }, [componentId, hasChanges]);

  // Unregister on unmount only
  useEffect(() => {
    return () => {
      if (contextRef.current) {
        contextRef.current.unregister(componentId);
      }
    };
  }, [componentId]);
}
