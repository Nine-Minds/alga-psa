/**
 * An explicit "the host timeline's comments changed" event, in the shape the ticket screen's
 * `screen.subscribeCommentsChanged` expects. `fire` is called only from an explicit publish event;
 * it is deliberately NOT derived from a session's `subscribe` / `version`, because the screen's
 * re-read calls `session.load()` (which bumps `version`) and would then refresh itself forever.
 */
export function createCommentsChangedSignal() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    fire: () => { [...listeners].forEach(listener => listener()); },
  };
}
export type CommentsChangedSignal = ReturnType<typeof createCommentsChangedSignal>;
