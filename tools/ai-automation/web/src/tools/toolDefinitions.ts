import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages';

interface ToolProperty {
  type: "string" | "number" | "boolean" | "object";
  description?: string;
}

const createTool = (
  name: string, 
  description: string, 
  properties: Record<string, ToolProperty> = {}, 
  required: string[] = []
): Tool => ({
  name,
  description,
  input_schema: {
    type: "object",
    properties,
    required,
  },
});

export const observeTool = createTool(
  'observe_browser',
  'Retrieves information about elements matching a CSS selector on the current page, along with page URL and title.',
  {
    selector: {
      type: "string",
      description: "CSS selector to find elements on the page. If omitted, returns just page info without elements.",
    }
  }
);

export const scriptTool = createTool(
  'execute_script',
  'Executes arbitrary JavaScript in the browser context, allowing you to send puppeteer commands to the browser.',
  {
    code: {
      type: "string",
      description: 'The JavaScript code to run in the browser context',
    },
  },
  ['code']
);

export const waitTool = createTool(
  'wait',
  'Pauses execution for a specified number of seconds',
  {
    seconds: {
      type: "number",
      description: "Number of seconds to wait",
    },
  },
  ['seconds']
);

export const puppeteerScriptTool = createTool(
  'execute_puppeteer_script',
  'Executes Puppeteer commands in the browser context. The script should be an async function that receives a Puppeteer Page object.',
  {
    script: {
      type: "string",
      description: 'The Puppeteer script to execute. Must be an async function that takes a Page object as parameter.',
    },
  },
  ['script']
);

export const tools = [observeTool, scriptTool, waitTool, puppeteerScriptTool];
