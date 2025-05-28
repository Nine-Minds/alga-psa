import { PageState } from './types/ui-reflection.js';

class UIStateManager {
  private currentState: PageState | null = null;
  private instanceId: string = Math.random().toString(36).substring(7);

  updateState(state: PageState) {
    console.log('\x1b[107m\x1b[30m[UI-STATE-MGR] 🔄 Updating UI state\x1b[0m', {
      instanceId: this.instanceId,
      pageId: state.id,
      title: state.title,
      componentCount: state.components?.length || 0
    });
    this.currentState = state;
    console.log('\x1b[48;5;22m[UI-STATE-MGR] ✅ UI state updated successfully\x1b[0m');
  }

  getCurrentState(): PageState | null {
    console.log('\x1b[48;5;23m[UI-STATE-MGR] 📖 Getting current UI state\x1b[0m', {
      instanceId: this.instanceId,
      hasState: !!this.currentState,
      componentCount: this.currentState?.components?.length || 0
    });
    return this.currentState;
  }
}

export const uiStateManager = new UIStateManager();
