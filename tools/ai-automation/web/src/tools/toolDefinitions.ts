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
  'Retrieves the current state of the browser page (URL, title, HTML).'
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

// export const nodeScriptTool = createTool(
//   'execute_node_script',
//   'Executes arbitrary Node.js code in the server context with access to Puppeteer.',
//   {
//     code: {
//       type: "string",
//       description: 'The Node.js code to run on the server with Puppeteer access.',
//     },
//   },
//   ['code']
// );

export const tools = [observeTool, scriptTool]; //, nodeScriptTool];
