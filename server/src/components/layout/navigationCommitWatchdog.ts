const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 9000];

// The app router can silently drop a pending link navigation when a
// concurrent server-action response lands mid-transition (frequent right
// after login, when dashboard widgets fire a burst of actions): the click
// runs router.push, yet the URL never changes. Re-issue the push until the
// location leaves the page the click started on.
export function armNavigationCommitWatchdog(
  href: string,
  push: (href: string) => void,
  delays: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): () => void {
  const fromPath = window.location.pathname;
  const timers = delays.map((delay) =>
    window.setTimeout(() => {
      if (window.location.pathname === fromPath) {
        push(href);
      }
    }, delay),
  );
  return () => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
  };
}
