'use client';

import { createContext, useContext } from 'react';

export interface ContactDrawerOptions {
  /** Runs after the quick view saves, so the opener can refresh its own copy. */
  onChangesSaved?: () => void;
}

export interface ContactDrawerContextType {
  openContactDrawer: (contactId: string, options?: ContactDrawerOptions) => void;
}

export const ContactDrawerContext = createContext<ContactDrawerContextType | undefined>(undefined);

/**
 * Returns the contact drawer context, or undefined where no provider is
 * mounted. The contact quick view lives in @alga-psa/clients, which feature
 * packages may not import — the composition layer provides it, and callers
 * fall back to a link when it is absent (the same shape as useClientDrawer).
 */
export function useContactDrawer(): ContactDrawerContextType | undefined {
  return useContext(ContactDrawerContext);
}
