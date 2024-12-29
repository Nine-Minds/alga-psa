const API_BASE = 'http://localhost:4000/api';

// 1) Observe Browser
export async function observeBrowser(selector?: string) {
  const endpoint = `${API_BASE}/observe${selector ? `?selector=${encodeURIComponent(selector)}` : ''}`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const error = `Failed to observe: ${response.status}`;
      throw new Error(error);
    }

    const result = await response.json();
    const successResult = { success: true, result };
    return successResult;
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    return errorResult;
  }
}

// 2) Execute Browser Script
export async function executeScript(code: string) {
  const endpoint = `${API_BASE}/script`;
  const body = { code };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = `Failed to execute script: ${response.status}`;
      throw new Error(error);
    }

    const result = await response.json();
    
    const successResult = { success: true, result };
    return successResult;
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    return errorResult;
  }
}

// 3) Wait
export async function wait(seconds: number) {
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
export async function executePuppeteerScript(script: string) {
  const endpoint = `${API_BASE}/puppeteer`;
  const body = { script };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = `Failed to execute puppeteer script: ${response.status}`;
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
}

export const invokeTool = async (toolName: string, args: ToolArgs) => {
  switch (toolName) {
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
