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
  console.log('%c[INVOKE-TOOL] 🎯 getUIState called', 'color: #ff6348; font-weight: bold', { jsonpath });
  
  // if (!jsonpath || jsonpath == '$.components') {
  //   console.log('%c[INVOKE-TOOL] ⚠️ JSONPath too broad, returning warning', 'color: #ffa502');
  //   return {
  //     success: true,
  //     result: {
  //       message: 'TOO BROAD - please narrow your search with a specific JSONPath'
  //     }
  //   };
  // }

  const endpoint = `${API_BASE}/ui-state${jsonpath ? `?jsonpath=${encodeURIComponent(jsonpath)}` : ''}`;
  console.log(`%c[INVOKE-TOOL] 📡 Making API call to: ${endpoint}`, 'color: #3742fa; font-weight: bold');
  
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
    });
    
    console.log(`%c[INVOKE-TOOL] 📊 API response status: ${response.status}`, 'color: #2ed573; font-weight: bold');
    
    if (!response.ok) {
      const error = `Failed to get UI state: ${response.status}`;
      console.error(`%c[INVOKE-TOOL] ❌ API error: ${error}`, 'color: #ff4757');
      throw new Error(error);
    }

    const result = await response.json();
    console.log('%c[INVOKE-TOOL] ✅ API result received', 'color: #1dd1a1; font-weight: bold', result);
    return { success: true, result };
  } catch (error) {
    console.error('%c[INVOKE-TOOL] 💥 Exception caught', 'color: #ff3838; font-weight: bold', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 1) Observe Browser
export async function observeBrowser(selector?: string): Promise<ToolExecutionResult> {
  console.log('%c[OBSERVE-BROWSER] 👁️ Starting browser observation', 'color: #e74c3c; font-weight: bold', { 
    selector: selector || 'all elements',
    hasSelector: !!selector 
  });
  
  const endpoint = `${API_BASE}/observe${selector ? `?selector=${encodeURIComponent(selector)}` : ''}`;
  console.log(`%c[OBSERVE-BROWSER] 📡 API endpoint: ${endpoint}`, 'color: #3498db; font-weight: bold');
  
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
    });
    
    console.log(`%c[OBSERVE-BROWSER] 📊 Response status: ${response.status}`, 'color: #27ae60; font-weight: bold');
    
    if (!response.ok) {
      const errorText = await response.text();
      const error = `Failed to observe: ${response.status} - ${errorText}`;
      console.error(`%c[OBSERVE-BROWSER] ❌ API error: ${error}`, 'color: #e74c3c; font-weight: bold');
      throw new Error(error);
    }

    const result = await response.json();
    console.log('%c[OBSERVE-BROWSER] ✅ Observation complete', 'color: #2ecc71; font-weight: bold', {
      elementCount: Array.isArray(result.elements) ? result.elements.length : 'unknown',
      pageTitle: result.title || 'unknown'
    });
    return { success: true, result };
  } catch (error) {
    console.error('%c[OBSERVE-BROWSER] 💥 Exception caught', 'color: #e74c3c; font-weight: bold', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 2) Execute Browser Script
export async function executeScript(code: string): Promise<ToolExecutionResult> {
  console.log('%c[EXECUTE-SCRIPT] 📜 Starting script execution', 'color: #9b59b6; font-weight: bold');
  console.log('%c[EXECUTE-SCRIPT] 💻 Script code:', 'color: #8e44ad; font-weight: bold', code.substring(0, 200) + (code.length > 200 ? '...' : ''));
  
  const endpoint = `${API_BASE}/script`;
  const body = { code };
  console.log(`%c[EXECUTE-SCRIPT] 📡 Sending to: ${endpoint}`, 'color: #3498db; font-weight: bold');
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body, null, 0),
    });

    console.log(`%c[EXECUTE-SCRIPT] 📊 Response status: ${response.status}`, 'color: #27ae60; font-weight: bold');

    if (!response.ok) {
      const errorText = await response.text();
      const error = `Failed to execute script: ${errorText}`;
      console.error(`%c[EXECUTE-SCRIPT] ❌ API error: ${error}`, 'color: #e74c3c; font-weight: bold');
      throw new Error(error);
    }

    const result = await response.json();
    console.log('%c[EXECUTE-SCRIPT] ✅ Script execution complete', 'color: #2ecc71; font-weight: bold', result);
    return { success: true, result };
  } catch (error) {
    console.error('%c[EXECUTE-SCRIPT] 💥 Exception caught', 'color: #e74c3c; font-weight: bold', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 3) Wait
export async function wait(seconds: number): Promise<ToolExecutionResult> {
  console.log(`%c[WAIT] ⏳ Starting wait for ${seconds} seconds`, 'color: #f39c12; font-weight: bold');
  const startTime = Date.now();
  
  try {
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    const actualTime = (Date.now() - startTime) / 1000;
    console.log(`%c[WAIT] ✅ Wait completed after ${actualTime.toFixed(2)} seconds`, 'color: #2ecc71; font-weight: bold');
    return {
      success: true,
      result: { 
        message: `Waited for ${seconds} seconds`,
        actualTime: actualTime,
        requestedTime: seconds
      }
    };
  } catch (error) {
    console.error('%c[WAIT] 💥 Exception during wait', 'color: #e74c3c; font-weight: bold', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// 4) Execute Puppeteer Script
export async function executeAutomationScript(script: string): Promise<ToolExecutionResult> {
  console.log('%c[AUTOMATION-SCRIPT] 🤖 Starting Puppeteer script execution', 'color: #e67e22; font-weight: bold');
  console.log('%c[AUTOMATION-SCRIPT] 📝 Script preview:', 'color: #d35400; font-weight: bold', script.substring(0, 300) + (script.length > 300 ? '...' : ''));
  
  if (script.indexOf('{username}') !== -1 || script.indexOf('{password}') !== -1) {
    console.error('%c[AUTOMATION-SCRIPT] ⚠️ Security violation: script contains template variables', 'color: #e74c3c; font-weight: bold');
    return {
      success: false,
      error: 'Please do not include \'{username}\' or \'{password}\' in the script. Use the provided username and password instead.'
    };
  }

  const endpoint = `${API_BASE}/puppeteer`;
  const body = { script };
  console.log(`%c[AUTOMATION-SCRIPT] 📡 Sending to: ${endpoint}`, 'color: #3498db; font-weight: bold');
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body, null, 0),
    });

    console.log(`%c[AUTOMATION-SCRIPT] 📊 Response status: ${response.status}`, 'color: #27ae60; font-weight: bold');

    if (!response.ok) {
      const result = await response.json();
      const error = `Failed to execute puppeteer script: ${result}`;
      console.error('%c[AUTOMATION-SCRIPT] ❌ Script execution failed', 'color: #e74c3c; font-weight: bold', error);
      console.log('%c[AUTOMATION-SCRIPT] 📋 Error details:', 'color: #e74c3c', result);
      
      return {
        success: false,
        result: result
      };
    }

    const result = await response.json();
    console.log('%c[AUTOMATION-SCRIPT] ✅ Script execution successful', 'color: #2ecc71; font-weight: bold', {
      resultType: typeof result,
      hasOutput: !!result.output,
      hasError: !!result.error
    });
    return {
      success: true,
      result
    };
  } catch (error) {
    console.error('%c[AUTOMATION-SCRIPT] 💥 Exception caught', 'color: #e74c3c; font-weight: bold', error);
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
  filePath?: string;
  startLine?: number;
  endLine?: number;
  pattern?: string;
  directory?: string;
  filePattern?: string;
  recursive?: boolean;
  maxResults?: number;
  name?: string;
  type?: string;
  extension?: string;
  showHidden?: boolean;
  maxDepth?: number;
  searchTerm?: string;
  fileTypes?: string[];
  [key: string]: unknown;
}

// Codebase navigation tools
export async function codebaseTool(toolName: string, args: ToolArgs): Promise<ToolExecutionResult> {
  console.log(`%c[CODEBASE-TOOL] 🗂️ Starting ${toolName} execution`, 'color: #16a085; font-weight: bold');
  
  // Log relevant parameters based on tool type
  const logParams: Record<string, unknown> = {};
  if (args.filePath) logParams.filePath = args.filePath;
  if (args.directory) logParams.directory = args.directory;
  if (args.pattern) logParams.pattern = args.pattern;
  if (args.searchTerm) logParams.searchTerm = args.searchTerm;
  if (args.filePattern) logParams.filePattern = args.filePattern;
  if (args.extension) logParams.extension = args.extension;
  if (args.recursive !== undefined) logParams.recursive = args.recursive;
  if (args.maxResults) logParams.maxResults = args.maxResults;
  if (args.maxDepth) logParams.maxDepth = args.maxDepth;
  if (args.startLine) logParams.startLine = args.startLine;
  if (args.endLine) logParams.endLine = args.endLine;
  
  console.log(`%c[CODEBASE-TOOL] 📋 Tool parameters:`, 'color: #138d75; font-weight: bold', logParams);
  
  const endpoint = `${API_BASE}/tool`;
  const body = { toolName, args };
  console.log(`%c[CODEBASE-TOOL] 📡 Sending to: ${endpoint}`, 'color: #3498db; font-weight: bold');
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body, null, 0),
    });

    console.log(`%c[CODEBASE-TOOL] 📊 Response status: ${response.status}`, 'color: #27ae60; font-weight: bold');

    if (!response.ok) {
      const errorText = await response.text();
      const error = `Failed to execute tool: ${errorText}`;
      console.error(`%c[CODEBASE-TOOL] ❌ Tool execution failed: ${error}`, 'color: #e74c3c; font-weight: bold');
      throw new Error(error);
    }

    const result = await response.json();
    
    // Log result summary based on tool type
    const resultSummary: Record<string, unknown> = { resultType: typeof result };
    if (Array.isArray(result)) {
      resultSummary.itemCount = result.length;
    } else if (result && typeof result === 'object') {
      if (result.files) resultSummary.fileCount = Array.isArray(result.files) ? result.files.length : 'unknown';
      if (result.matches) resultSummary.matchCount = Array.isArray(result.matches) ? result.matches.length : 'unknown';
      if (result.content) resultSummary.hasContent = true;
      if (result.lines) resultSummary.lineCount = Array.isArray(result.lines) ? result.lines.length : 'unknown';
    }
    
    console.log(`%c[CODEBASE-TOOL] ✅ Tool execution successful`, 'color: #2ecc71; font-weight: bold', resultSummary);
    return { success: true, result };
  } catch (error) {
    console.error('%c[CODEBASE-TOOL] 💥 Exception caught', 'color: #e74c3c; font-weight: bold', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export const invokeTool = async (toolName: string, args: ToolArgs) => {
  console.log(`%c[INVOKE-TOOL] 🎪 Tool dispatcher called: ${toolName}`, 'color: #ff9ff3; font-weight: bold', args);
  
  switch (toolName) {
    case 'get_ui_state':
      console.log('%c[INVOKE-TOOL] 🎯 Routing to getUIState', 'color: #ff6348');
      return getUIState(args.jsonpath);
    case 'observe_browser':
      console.log('%c[INVOKE-TOOL] 👁️ Routing to observeBrowser', 'color: #ff6348');
      return observeBrowser(args.selector);
    case 'execute_script':
      console.log('%c[INVOKE-TOOL] 📜 Routing to executeScript', 'color: #ff6348');
      if (!args.code) {
        throw new Error('code argument is required for execute_script');
      }
      return executeScript(args.code);
    case 'wait':
      console.log('%c[INVOKE-TOOL] ⏳ Routing to wait', 'color: #ff6348');
      if (!args.seconds) {
        throw new Error('seconds argument is required for wait');
      }
      return wait(args.seconds);
    case 'execute_automation_script':
      console.log('%c[INVOKE-TOOL] 🤖 Routing to executeAutomationScript', 'color: #ff6348');
      if (!args.script) {
        throw new Error('script argument is required for execute_automation_script');
      }
      return executeAutomationScript(args.script);
    case 'read_file':
      console.log('%c[INVOKE-TOOL] 📖 Routing to codebaseTool (read_file)', 'color: #ff6348');
      return codebaseTool(toolName, args);
    case 'grep_files':
      console.log('%c[INVOKE-TOOL] 🔍 Routing to codebaseTool (grep_files)', 'color: #ff6348');
      return codebaseTool(toolName, args);
    case 'find_files':
      console.log('%c[INVOKE-TOOL] 🗂️ Routing to codebaseTool (find_files)', 'color: #ff6348');
      return codebaseTool(toolName, args);
    case 'list_directory':
      console.log('%c[INVOKE-TOOL] 📁 Routing to codebaseTool (list_directory)', 'color: #ff6348');
      return codebaseTool(toolName, args);
    case 'search_automation_ids':
      console.log('%c[INVOKE-TOOL] 🔎 Routing to codebaseTool (search_automation_ids)', 'color: #ff6348');
      return codebaseTool(toolName, args);
    case 'get_navigation_help':
      console.log('%c[INVOKE-TOOL] 🧭 Routing to codebaseTool (get_navigation_help)', 'color: #ff6348');
      return codebaseTool(toolName, args);
    default:
      console.error(`%c[INVOKE-TOOL] ❌ Unknown tool: ${toolName}`, 'color: #ff4757');
      throw new Error(`Unknown tool: ${toolName}`);
  }
};
