import { Tool } from './Tool';
import { Page } from 'puppeteer';
import { uiStateManager } from '../uiStateManager';
import { PageState } from '../types/ui-reflection';

export const getUIState: Tool = {
  name: 'get_ui_state',
  description: 'Get the current high-level UI state including all registered components',
  
  async execute(_page: Page, _args: any): Promise<PageState> {
    const state = uiStateManager.getCurrentState();
    if (!state) {
      throw new Error('No UI state available. Make sure the React application is running and connected.');
    }
    return state;
  }
};
