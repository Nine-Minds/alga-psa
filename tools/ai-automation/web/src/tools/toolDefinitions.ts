export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Define available tools for the AI to use
export const tools: Tool[] = [
  {
    name: 'observe_browser',
    description: 'Observe elements in the browser matching a CSS selector. Use this tool when you cannot find what you are looking for with the get_ui_state tool.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to find elements'
        }
      },
      required: ['selector']
    },
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to find elements'
        }
      },
      required: ['selector']
    }
  },
  {
    name: 'execute_script',
    description: 'Execute JavaScript code in the browser context',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute'
        }
      },
      required: ['code']
    },
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute'
        }
      },
      required: ['code']
    }
  },
  {
    name: 'wait',
    description: 'Wait for a specified number of seconds',
    parameters: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: 'Number of seconds to wait'
        }
      },
      required: ['seconds']
    },
    input_schema: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: 'Number of seconds to wait'
        }
      },
      required: ['seconds']
    }
  },
  {
    name: 'execute_automation_script',
    description: 'Execute a Puppeteer script for browser automation, passing in a script argument as a self-executing function.',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Puppeteer script to execute, formatted as a self-executing function'
        }
      },
      required: ['script']
    },
    input_schema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Puppeteer script to execute'
        }
      },
      required: ['script']
    }
  },
  {
    name: 'get_ui_state',
    description: 'Get the current UI state of the page, optionally filtered by a JSONPath expression. This is your main tool for understanding what the user is seeing on the page. The JSONPath must start with $ and can use filters like [?(@.type=="button")]. Returns full state if no path provided, filtered results if path matches, or error message if path is invalid.',
    parameters: {
      type: 'object',
      properties: {
        jsonpath: {
          type: 'string',
          description: 'Optional JSONPath expression to filter the UI state. Must start with $. Examples: $.components[?(@.type=="button")], $.components[?(@.id=="contacts-table")]'
        }
      }
    },
    input_schema: {
      type: 'object',
      properties: {
        jsonpath: {
          type: 'string',
          description: 'Optional JSONPath expression to filter the UI state. Must start with $. Examples: $.components[?(@.type=="button")], $.components[?(@.id=="contacts-table")]'
        }
      }
    }
  }
];
