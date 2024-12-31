import { PageState } from './types/ui-reflection';

class UIStateManager {
  private currentState: PageState | null = null;

  updateState(state: PageState) {
    this.currentState = state;
  }

  getCurrentState(): PageState | null {
    return this.currentState;
  }
}

export const uiStateManager = new UIStateManager();
