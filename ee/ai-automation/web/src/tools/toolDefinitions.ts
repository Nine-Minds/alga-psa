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
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file from the codebase. Useful for understanding component implementations and finding automation IDs.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file relative to project root'
        },
        startLine: {
          type: 'number',
          description: 'Optional start line number (1-based)'
        },
        endLine: {
          type: 'number',
          description: 'Optional end line number (1-based)'
        }
      },
      required: ['filePath']
    },
    input_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file relative to project root'
        },
        startLine: {
          type: 'number',
          description: 'Optional start line number (1-based)'
        },
        endLine: {
          type: 'number',
          description: 'Optional end line number (1-based)'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'grep_files',
    description: 'Search for patterns in files using grep. Useful for finding specific text, function names, or component patterns.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Pattern to search for'
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (default: ".")'
        },
        filePattern: {
          type: 'string',
          description: 'File pattern to include (default: "*")'
        },
        recursive: {
          type: 'boolean',
          description: 'Search recursively (default: true)'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 100)'
        }
      },
      required: ['pattern']
    },
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Pattern to search for'
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (default: ".")'
        },
        filePattern: {
          type: 'string',
          description: 'File pattern to include (default: "*")'
        },
        recursive: {
          type: 'boolean',
          description: 'Search recursively (default: true)'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 100)'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'find_files',
    description: 'Find files and directories using patterns. Useful for locating component files.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name pattern to match'
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (default: ".")'
        },
        type: {
          type: 'string',
          description: 'Type: "f" for files, "d" for directories'
        },
        extension: {
          type: 'string',
          description: 'File extension to filter by'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 100)'
        }
      }
    },
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name pattern to match'
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (default: ".")'
        },
        type: {
          type: 'string',
          description: 'Type: "f" for files, "d" for directories'
        },
        extension: {
          type: 'string',
          description: 'File extension to filter by'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 100)'
        }
      }
    }
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory. Useful for exploring the codebase structure.',
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to list (default: ".")'
        },
        showHidden: {
          type: 'boolean',
          description: 'Show hidden files (default: false)'
        },
        recursive: {
          type: 'boolean',
          description: 'List recursively (default: false)'
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum recursion depth (default: 2)'
        }
      }
    },
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to list (default: ".")'
        },
        showHidden: {
          type: 'boolean',
          description: 'Show hidden files (default: false)'
        },
        recursive: {
          type: 'boolean',
          description: 'List recursively (default: false)'
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum recursion depth (default: 2)'
        }
      }
    }
  },
  {
    name: 'search_automation_ids',
    description: 'Search for automation IDs (data-automation-id) in the codebase. This is the most useful tool for finding the correct element IDs to use in automation scripts.',
    parameters: {
      type: 'object',
      properties: {
        searchTerm: {
          type: 'string',
          description: 'Optional search term to filter automation IDs'
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (default: "server/src")'
        },
        fileTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'File types to search (default: ["tsx", "ts", "jsx", "js"])'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 50)'
        }
      }
    },
    input_schema: {
      type: 'object',
      properties: {
        searchTerm: {
          type: 'string',
          description: 'Optional search term to filter automation IDs'
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (default: "server/src")'
        },
        fileTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'File types to search (default: ["tsx", "ts", "jsx", "js"])'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results (default: 50)'
        }
      }
    }
  },
  {
    name: 'get_navigation_help',
    description: 'Get quick navigation guidance for common screens and actions. Provides shortcuts to common navigation patterns.',
    parameters: {
      type: 'object',
      properties: {
        screen: {
          type: 'string',
          description: 'Specific screen to get navigation help for (e.g., "billing", "tickets", "user-activities")'
        },
        action: {
          type: 'string',
          description: 'Specific action to get guidance for (e.g., "login", "create-record", "filter-data")'
        }
      }
    },
    input_schema: {
      type: 'object',
      properties: {
        screen: {
          type: 'string',
          description: 'Specific screen to get navigation help for (e.g., "billing", "tickets", "user-activities")'
        },
        action: {
          type: 'string',
          description: 'Specific action to get guidance for (e.g., "login", "create-record", "filter-data")'
        }
      }
    }
  }
];
