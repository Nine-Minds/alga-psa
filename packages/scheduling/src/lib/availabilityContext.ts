export const AVAILABILITY_CONTEXT_STORAGE_KEY = 'schedule:availability-context';

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
