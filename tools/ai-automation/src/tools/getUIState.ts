import { Tool } from './Tool';
import { Page } from 'puppeteer';
import { uiStateManager } from '../uiStateManager';
import { PageState } from '../types/ui-reflection';
import { JSONPath } from 'jsonpath-plus';

interface GetUIStateArgs {
  jsonpath?: string;
}

export const getUIState: Tool = {
  name: 'get_ui_state',
  description: 'Get the current high-level UI state including all registered components',
  
  async execute(_page: Page, args: GetUIStateArgs): Promise<PageState | any> {
    if (!args.jsonpath) {
      return "TOO BROAD - please narrow your search with a JSONPath";
    }

    const state = uiStateManager.getCurrentState();
    if (!state) {
      throw new Error('No UI state available. Make sure the React application is running and connected.');
    }

    // If no JSONPath provided, return full state
    if (!args.jsonpath) {
      return state;
    }

    // Apply JSONPath filter with error handling
    try {
      // First validate that the path is well-formed
      if (!args.jsonpath.startsWith('$')) {
        throw new Error('JSONPath must start with $');
      }

      // Wrap the evaluation in a try-catch to handle runtime errors
      try {
        const result = JSONPath({
          path: args.jsonpath,
          json: state,
          wrap: false // Don't wrap single results in an array
        });

        // Handle no matches
        if (result === undefined || result === null || (Array.isArray(result) && result.length === 0)) {
          return { message: `No components found matching path: ${args.jsonpath}` };
        }

        return result;
      } catch (evalError) {
        // Handle evaluation errors (like null property access)
        throw new Error(`Error evaluating JSONPath: ${evalError instanceof Error ? evalError.message : String(evalError)}`);
      }
    } catch (error) {
      // Return a structured error response instead of throwing
      return {
        error: true,
        message: `Invalid JSONPath: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
};
