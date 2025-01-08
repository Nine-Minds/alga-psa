export interface ToolExecutionResult {
  error?: string;
  success?: boolean;
  result?: {
    url?: string;
    title?: string;
    elements?: unknown[];
    [key: string]: unknown;
  };
}

const API_BASE = 'http://localhost:4000/api';

// Get UI State
export async function getUIState(jsonpath?: string): Promise<ToolExecutionResult> {
  if (!jsonpath || jsonpath == '$.components') {
    return {
      success: true,
      result: {
        message: 'TOO BROAD - please narrow your search with a specific JSONPath'
      }
    };
  }

  const endpoint = `${API_BASE}/ui-state${jsonpath ? `?jsonpath=${encodeURIComponent(jsonpath)}` : ''}`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const error = `Failed to get UI state: ${response.status}`;
      throw new Error(error);
    }

    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 1) Observe Browser
export async function observeBrowser(selector?: string): Promise<ToolExecutionResult> {
  const endpoint = `${API_BASE}/observe${selector ? `?selector=${encodeURIComponent(selector)}` : ''}`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      const error = `Failed to observe: ${response.status} - ${errorText}`;
      throw new Error(error);
    }

    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 2) Execute Browser Script
export async function executeScript(code: string): Promise<ToolExecutionResult> {
  const endpoint = `${API_BASE}/script`;
  const body = { code };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body, null, 0),
    });

    if (!response.ok) {
      const error = `Failed to execute script: ${await response.text()}`;
      throw new Error(error);
    }

    const result = await response.json();
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 3) Wait
export async function wait(seconds: number): Promise<ToolExecutionResult> {
  try {
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return {
      success: true,
      result: { message: `Waited for ${seconds} seconds` }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 4) Execute Puppeteer Script
export async function executePuppeteerScript(script: string): Promise<ToolExecutionResult> {
  if (script.indexOf('{username}') !== -1 || script.indexOf('{password}') !== -1) {
    return {
      success: false,
      error: 'Please do not include \'{username}\' or \'{password}\' in the script. Use the provided username and password instead.'
    };
  }

  const endpoint = `${API_BASE}/puppeteer`;
  const body = { script };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body, null, 0),
    });

    if (!response.ok) {
      const error = `Failed to execute puppeteer script: ${await response.text()}`;
      throw new Error(error);
    }

    const result = await response.json();
    return {
      success: true,
      result
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

interface ToolArgs {
  selector?: string;
  code?: string;
  seconds?: number;
  script?: string;
  jsonpath?: string;
}


export const invokeTool = async (toolName: string, args: ToolArgs) => {
  switch (toolName) {
    case 'get_ui_state':
      return getUIState(args.jsonpath);
    case 'observe_browser':
      return observeBrowser(args.selector);
    case 'execute_script':
      if (!args.code) {
        throw new Error('code argument is required for execute_script');
      }
      return executeScript(args.code);
    case 'wait':
      if (!args.seconds) {
        throw new Error('seconds argument is required for wait');
      }
      return wait(args.seconds);
    case 'execute_puppeteer_script':
      if (!args.script) {
        throw new Error('script argument is required for execute_puppeteer_script');
      }
      return executePuppeteerScript(args.script);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
