import { Tool } from './Tool.js';
import { Page } from 'puppeteer';
import { PageState } from '../types/ui-reflection.js';
import { JSONPath } from 'jsonpath-plus';

interface GetUIStateArgs {
  jsonpath?: string;
}

export const getUIState: Tool = {
  name: 'get_ui_state',
  description: 'Get the current high-level UI state including all registered components',
  
  async execute(page: Page, args: GetUIStateArgs): Promise<PageState | any> {
    console.log('🔍 [GET-UI-STATE] Using page context:', { 
      title: await page.title(), 
      url: page.url() 
    });
    // Get page info first since we'll need it for all responses
    const pageInfo = {
      page: {
        title: await page.title(),
        url: page.url()
      }
    };

    // IMPORTANT: Use HTTP API to get UI state from the same server instance
    console.log('🔍 [GET-UI-STATE] Fetching UI state via HTTP API...');
    let baseState;
    try {
      const response = await fetch('http://localhost:4000/api/ui-state');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const apiResult = await response.json();
      console.log('🔍 [GET-UI-STATE] API response:', {
        success: apiResult.success,
        hasState: apiResult.hasState,
        componentCount: apiResult.componentCount
      });
      
      baseState = apiResult.state;
      console.log('🔍 [GET-UI-STATE] Retrieved state:', baseState ? {
        id: baseState.id,
        title: baseState.title,
        componentCount: baseState.components?.length || 0
      } : null);
    } catch (error) {
      console.log('❌ [GET-UI-STATE] Failed to fetch UI state via API:', error);
      return {
        ...pageInfo,
        result: {
          error: true,
          message: `Failed to fetch UI state: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
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
      args.jsonpath = '$..*'; // Default to all components
      // return {
      //   ...pageInfo,
      //   result: {
      //     message: "TOO BROAD - please narrow your search with a JSONPath"
      //   }
      // };
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
