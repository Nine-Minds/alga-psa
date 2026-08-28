export const AVAILABILITY_CONTEXT_STORAGE_KEY = 'schedule:availability-context';
export const AVAILABILITY_ACCESS_HINT_STORAGE_KEY = 'schedule:availability-access';

export interface PersistedAvailabilityContext {
  isOpen: boolean;
  activeTab: string;
  selectedTeamId: string;
  selectedUserId: string;
}

export function readAvailabilityContext(): PersistedAvailabilityContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(AVAILABILITY_CONTEXT_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      isOpen: parsed.isOpen === true,
      activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab : 'general',
      selectedTeamId: typeof parsed.selectedTeamId === 'string' ? parsed.selectedTeamId : '',
      selectedUserId: typeof parsed.selectedUserId === 'string' ? parsed.selectedUserId : '',
    };
  } catch {
    return null;
  }
}

// The Configure Availability button is gated on a bootstrap read (permissions,
// users, teams, memberships) that costs seconds on a loaded machine, so the
// button used to pop into the header long after first paint: it shifted the
// buttons beside it and missed clicks aimed at it. Remembering the last answer
// for this tab lets a repeat visit paint the button immediately; the live check
// still runs and corrects the hint, and every action re-authorizes server-side.
// A refresh is the one navigation that should put the reader back inside the
// dialog they were working in. Arriving at Schedule any other way must not pop
// a modal nobody asked for: it would sit over the page and swallow the reader's
// next click (including the Configure Availability button behind it).
export function isReloadNavigation(): boolean {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return false;
  try {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return entry?.type === 'reload';
  } catch {
    return false;
  }
}

export function readAvailabilityAccessHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(AVAILABILITY_ACCESS_HINT_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeAvailabilityAccessHint(canConfigure: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(AVAILABILITY_ACCESS_HINT_STORAGE_KEY, canConfigure ? 'true' : 'false');
  } catch {
    // Storage can be unavailable in private mode; the live check still governs.
  }
}

export function writeAvailabilityContext(update: Partial<PersistedAvailabilityContext>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readAvailabilityContext() ?? {
      isOpen: false,
      activeTab: 'general',
      selectedTeamId: '',
      selectedUserId: '',
    };
    window.sessionStorage.setItem(
      AVAILABILITY_CONTEXT_STORAGE_KEY,
      JSON.stringify({ ...current, ...update })
    );
  } catch {
    // Storage can be unavailable in private mode; the dialog remains usable in-memory.
  }
}
