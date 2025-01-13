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
  
  async execute(page: Page, args: GetUIStateArgs): Promise<PageState | any> {
    // Get page info first since we'll need it for all responses
    const pageInfo = {
      page: {
        title: await page.title(),
        url: page.url()
      }
    };

    const baseState = uiStateManager.getCurrentState();
    if (!baseState) {
      return {
        ...pageInfo,
        result: {
          error: true,
          message: 'No UI state available. Make sure the React application is running and connected.'
        }
      };
    }

    const state = {
      ...baseState,
      ...pageInfo
    };

    // Require JSONPath to prevent overly broad queries
    if (!args.jsonpath) {
      return {
        ...pageInfo,
        result: {
          message: "TOO BROAD - please narrow your search with a JSONPath"
        }
      };
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
          ignoreEvalErrors: true,
          wrap: false // Don't wrap single results in an array
        });

        // Handle no matches
        if (result === undefined || result === null || (Array.isArray(result) && result.length === 0)) {
          return {
            ...pageInfo,
            result: {
              message: `No components found matching path: ${args.jsonpath}`
            }
          };
        }

        return {
          ...pageInfo,
          result
        };
      } catch (evalError) {
        // Handle evaluation errors (like null property access)
          return {
            ...pageInfo,
            result: {
              error: true,
              message: `Error evaluating JSONPath: ${evalError instanceof Error ? evalError.message : String(evalError)}`
            }
          };
      }
    } catch (error) {
      // Return a structured error response instead of throwing
      return {
        ...pageInfo,
        result: {
          error: true,
          message: `Invalid JSONPath: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }
};
