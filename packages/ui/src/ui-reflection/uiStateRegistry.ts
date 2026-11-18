import type { PageState, UIComponent } from './types';

/**
 * React-free component registry behind UIStateProvider.
 *
 * Mutations (register / update / unregister) are applied to the dictionary
 * immediately and in place, in O(1) amortised time (unregister is
 * O(size of removed subtree) thanks to a parent -> children index). The tree
 * rebuild + publish is deferred and coalesced: at most one rebuild per
 * microtask flush, or immediately via flush().
 *
 * Ordinals are assigned exactly as before: a new id takes the next counter
 * value, re-registering an existing id keeps its ordinal.
 */
export interface UIStateRegistry {
  register(component: UIComponent | undefined): void;
  unregister(id: string): void;
  update(id: string, partial: Partial<UIComponent>): void;
  /** Synchronously rebuild + publish if there are pending mutations. Returns true if it published. */
  flush(): boolean;
  /** Last published state (null until the first publish). */
  getPublishedState(): PageState | null;
  /** Read-only lookup of the live (possibly not yet published) entry. */
  get(id: string): UIComponent | undefined;
  readonly size: number;
}

export interface UIStateRegistryOptions {
  /** Called once per flush that had pending mutations. */
  onPublish: (state: PageState) => void;
  /** Override the scheduler (default: queueMicrotask). Mainly for tests. */
  schedule?: (flush: () => void) => void;
}

const byOrdinal = (a: UIComponent, b: UIComponent) => (a.ordinal ?? 0) - (b.ordinal ?? 0);

export function createUIStateRegistry(options: UIStateRegistryOptions): UIStateRegistry {
  const schedule =
    options.schedule ??
    ((fn: () => void) => {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(fn);
      } else {
        void Promise.resolve().then(fn);
      }
    });

  const dict = new Map<string, UIComponent>();
  // parentId -> ids of components that name it as parent (parent need not be registered yet)
  const childIndex = new Map<string, Set<string>>();
  let nextOrdinal = 0;
  let dirty = false;
  let scheduled = false;
  let published: PageState | null = null;

  const indexAdd = (parentId: string, childId: string) => {
    let set = childIndex.get(parentId);
    if (!set) {
      set = new Set();
      childIndex.set(parentId, set);
    }
    set.add(childId);
  };

  const indexRemove = (parentId: string, childId: string) => {
    const set = childIndex.get(parentId);
    if (!set) return;
    set.delete(childId);
    if (set.size === 0) childIndex.delete(parentId);
  };

  const markDirty = () => {
    dirty = true;
    if (!scheduled) {
      scheduled = true;
      schedule(() => {
        scheduled = false;
        flush();
      });
    }
  };

  /** Rebuild children arrays and return sorted roots. O(N log N), once per flush. */
  const rebuild = (): UIComponent[] => {
    const roots: UIComponent[] = [];
    for (const comp of dict.values()) {
      comp.children = [];
    }
    for (const comp of dict.values()) {
      const parent = comp.parentId ? dict.get(comp.parentId) : undefined;
      if (parent) {
        parent.children!.push(comp);
      } else {
        roots.push(comp);
      }
    }
    for (const comp of dict.values()) {
      if (comp.children && comp.children.length > 1) comp.children.sort(byOrdinal);
    }
    roots.sort(byOrdinal);
    return roots;
  };

  function flush(): boolean {
    if (!dirty) return false;
    dirty = false;
    const state: PageState = {
      id: published?.id || 'page',
      title: published?.title || '',
      components: rebuild(),
    };
    published = state;
    options.onPublish(state);
    return true;
  }

  return {
    register(component) {
      if (!component) return;
      const existing = dict.get(component.id);
      const ordinal = existing ? existing.ordinal : nextOrdinal++;
      if (existing?.parentId) indexRemove(existing.parentId, component.id);
      const entry = { ...(existing || {}), ...component, ordinal } as UIComponent;
      if (entry.parentId) indexAdd(entry.parentId, entry.id);
      dict.set(entry.id, entry);
      markDirty();
    },

    unregister(id) {
      if (!dict.has(id)) return;
      // Collect the component and all descendants via the parent index.
      const toRemove: string[] = [];
      const visited = new Set<string>();
      const stack = [id];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current) || !dict.has(current)) continue;
        visited.add(current);
        toRemove.push(current);
        const kids = childIndex.get(current);
        if (kids) for (const k of kids) stack.push(k);
      }
      for (const removeId of toRemove) {
        const comp = dict.get(removeId)!;
        if (comp.parentId) indexRemove(comp.parentId, removeId);
        dict.delete(removeId);
      }
      // Drop index buckets of removed parents (their children were removed too).
      for (const removeId of toRemove) childIndex.delete(removeId);
      markDirty();
    },

    update(id, partial) {
      const existing = dict.get(id);
      if (!existing) return;
      const keys = Object.keys(partial) as (keyof UIComponent)[];
      const hasChanges = keys.some(
        (k) => k !== 'type' && k !== 'children' && k !== 'ordinal' && existing[k] !== partial[k]
      );
      if (!hasChanges) return;

      const entry = {
        ...existing,
        ...partial,
        type: existing.type,
        children: existing.children,
        ordinal: existing.ordinal,
      } as UIComponent;
      if (entry.parentId !== existing.parentId) {
        if (existing.parentId) indexRemove(existing.parentId, id);
        if (entry.parentId) indexAdd(entry.parentId, id);
      }
      dict.set(id, entry);
      markDirty();
    },

    flush,
    getPublishedState: () => published,
    get: (id) => dict.get(id),
    get size() {
      return dict.size;
    },
  };
}
