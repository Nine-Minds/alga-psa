'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { useCapability } from '@alga-psa/ui/hooks';

export interface RequesterTaskConversationProps { projectId: string; taskId: string }
const Context = createContext<ComponentType<RequesterTaskConversationProps> | null>(null);

/** The application provides optional collaboration UI without a package-to-app dependency. */
export function RequesterTaskConversationProvider({ component, children }: { component: ComponentType<RequesterTaskConversationProps>; children: ReactNode }) {
  return <Context.Provider value={component}>{children}</Context.Provider>;
}

/**
 * The task-thread button. It renders only when the co-managed capability ADMITS (release flag on, the
 * workspace entitled, not forced off) and the application supplied an implementation; the server
 * re-checks on every read and write. Never gate this on a raw release flag.
 */
export function RequesterTaskConversation(props: RequesterTaskConversationProps) {
  const { admitted } = useCapability('co-managed');
  const Component = useContext(Context);
  return admitted && Component ? <Component {...props} /> : null;
}
