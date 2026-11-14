'use client';

import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useCapability } from '@alga-psa/ui/hooks';

export interface RequesterTaskConversationProps { projectId: string; taskId: string }
/** The application's server answer to "which of this project's tasks are shared work?" (one predicate, server-side). */
export type LoadRequesterSharedTaskIds = (projectId: string) => Promise<string[]>;
interface Implementation { component: ComponentType<RequesterTaskConversationProps>; loadSharedTaskIds: LoadRequesterSharedTaskIds }
const Context = createContext<Implementation | null>(null);
const SharedTasks = createContext<ReadonlySet<string> | null>(null);

/** The application provides optional collaboration UI without a package-to-app dependency. */
export function RequesterTaskConversationProvider({ component, loadSharedTaskIds, children }: {
  component: ComponentType<RequesterTaskConversationProps>; loadSharedTaskIds: LoadRequesterSharedTaskIds; children: ReactNode;
}) {
  return <Context.Provider value={{ component, loadSharedTaskIds }}>{children}</Context.Provider>;
}

/**
 * The shared-work task ids of one project, or null until known (and always null when the capability does not
 * SERVE or the application supplied no implementation, so nothing is fetched and nothing changes for any
 * other portal). The decision is the server's; this never guesses client-side.
 */
export function useRequesterSharedTaskIds(projectId: string): ReadonlySet<string> | null {
  const { enabled } = useCapability('co-managed');
  const load = useContext(Context)?.loadSharedTaskIds;
  const [state, setState] = useState<{ projectId: string; ids: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!enabled || !load) return;
    let live = true;
    load(projectId).then(ids => { if (live) setState({ projectId, ids: new Set(ids) }); })
      .catch(() => { if (live) setState({ projectId, ids: new Set() }); });
    return () => { live = false; };
  }, [enabled, load, projectId]);
  return enabled && load && state?.projectId === projectId ? state.ids : null;
}

export function RequesterSharedTasksProvider({ ids, children }: { ids: ReadonlySet<string> | null; children: ReactNode }) {
  return <SharedTasks.Provider value={ids}>{children}</SharedTasks.Provider>;
}

/**
 * The task-thread button. It renders only when the co-managed capability SERVES (a customer requester is
 * served, never admitted: admission belongs to sponsors), the application supplied an implementation, AND the
 * server says this task is shared work. A sponsor's own native project is not shared work, so it never shows
 * it. The server re-checks on every read and write. Never gate this on a raw release flag.
 */
export function RequesterTaskConversation(props: RequesterTaskConversationProps) {
  const { enabled } = useCapability('co-managed');
  const Component = useContext(Context)?.component;
  const shared = useContext(SharedTasks);
  return enabled && Component && shared?.has(props.taskId) ? <Component {...props} /> : null;
}
