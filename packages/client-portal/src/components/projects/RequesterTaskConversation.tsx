'use client';
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
export interface RequesterTaskConversationProps { projectId: string; taskId: string }
const Context = createContext<ComponentType<RequesterTaskConversationProps> | null>(null);
/** The application provides optional collaboration UI without a package-to-app dependency. */
export function RequesterTaskConversationProvider({ component, children }: { component: ComponentType<RequesterTaskConversationProps>; children: ReactNode }) {
  return <Context.Provider value={component}>{children}</Context.Provider>;
}
export function RequesterTaskConversation(props: RequesterTaskConversationProps) {
  const Component = useContext(Context);
  return Component ? <Component {...props} /> : null;
}
